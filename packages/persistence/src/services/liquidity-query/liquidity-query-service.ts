import type {
    InstrumentCoverage,
    LiquidityFrameWindow,
    RecordingGap,
    TradeClusterQuery,
    TradeClusterWindow,
    WindowQuery,
} from '@fathom/contracts';
import type { PostgresService } from '../postgres/postgres-service.ts';
import {
    type InstrumentRow,
    type LiquidityFrameRow,
    type RecordingGapRow,
    toInstrumentCoverage,
    toLiquidityFrame,
    toRecordingGap,
    toTradeCluster,
    type TradeClusterRow,
} from './postgres-row-mapping.ts';

const MILLISECONDS_PER_SECOND = 1_000;
const FRAME_COLUMNS = `
    frame.captured_at,
    frame.best_bid_price,
    frame.best_ask_price,
    frame.bid_lowest_bucket_index,
    frame.bid_quantities,
    frame.ask_lowest_bucket_index,
    frame.ask_quantities`;

// Rolling up executions on demand means grouping tens of millions of rows on a
// wide range, so each request reads the coarsest pre-materialised grid that is
// still finer than the resolution it asked for.
const TRADE_SOURCES = [
    { table: 'trade_cluster', nativeIntervalMs: 1_000 },
    { table: 'trade_cluster_minute', nativeIntervalMs: 60_000 },
    { table: 'trade_cluster_hour', nativeIntervalMs: 3_600_000 },
] as const;

type TradeSource = (typeof TRADE_SOURCES)[number];

export interface LiquidityQueryServiceConfig {
    readonly postgres: PostgresService;
}

export interface FrameTailQuery {
    readonly symbol: string;
    readonly afterMs: number;
    readonly maxFrames: number;
}

interface InstrumentGrid {
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
}

/**
 * Read side of the recorded market history.
 *
 * Wide ranges are sampled rather than averaged: one stored frame represents each
 * output column. Resting liquidity persists across many frames, so a sampled
 * column shows the same walls an averaged one would, without the cost of reading
 * every depth array in the range.
 */
export class LiquidityQueryService {
    private readonly postgres: PostgresService;

    constructor(config: LiquidityQueryServiceConfig) {
        this.postgres = config.postgres;
    }

    /**
     * Every instrument a collector has registered, with its recorded extent.
     *
     * @returns Coverage per instrument, ordered by symbol.
     * @throws PostgresQueryError when the read fails.
     */
    async listInstruments(): Promise<InstrumentCoverage[]> {
        const rows = await this.postgres.selectRows<InstrumentRow>(`
            SELECT
                registry.instrument_symbol,
                registry.price_bucket_size,
                registry.frame_interval_ms,
                oldest.captured_at AS first_frame_at,
                newest.captured_at AS last_frame_at
            FROM instrument_registry registry
            LEFT JOIN LATERAL (
                SELECT captured_at FROM liquidity_frame
                WHERE instrument_symbol = registry.instrument_symbol
                ORDER BY captured_at ASC LIMIT 1
            ) oldest ON TRUE
            LEFT JOIN LATERAL (
                SELECT captured_at FROM liquidity_frame
                WHERE instrument_symbol = registry.instrument_symbol
                ORDER BY captured_at DESC LIMIT 1
            ) newest ON TRUE
            ORDER BY registry.instrument_symbol`);

        return rows.map(toInstrumentCoverage);
    }

    /**
     * Depth frames across a time range, sampled down to the requested column count.
     *
     * @param query - Instrument, half-open time range, and column budget.
     * @returns The sampled window; empty when the range holds no frames.
     * @throws PostgresQueryError when the read fails.
     */
    async fetchFrameWindow(query: WindowQuery): Promise<LiquidityFrameWindow> {
        const grid = await this.resolveInstrumentGrid(query.symbol);

        // Never sample finer than the recording. A request for more columns than
        // there are stored frames leaves empty buckets between the real ones, and
        // a renderer laying frames onto that grid draws a comb of blank columns.
        const sampleIntervalMs = Math.max(resolveSampleInterval(query), grid.frameIntervalMs);

        // One index probe per output column, rather than a scan that would read
        // every depth array in the range only to discard almost all of them.
        const rows = await this.postgres.selectRows<LiquidityFrameRow>(
            `SELECT ${FRAME_COLUMNS}
             FROM generate_series(
                 $2::timestamptz,
                 $3::timestamptz - make_interval(secs => $4),
                 make_interval(secs => $4)
             ) AS column_start
             CROSS JOIN LATERAL (
                 SELECT * FROM liquidity_frame
                 WHERE instrument_symbol = $1
                   AND captured_at >= column_start
                   AND captured_at < column_start + make_interval(secs => $4)
                 ORDER BY captured_at ASC
                 LIMIT 1
             ) frame
             ORDER BY frame.captured_at ASC`,
            [
                query.symbol,
                new Date(query.fromMs),
                new Date(query.toMs),
                sampleIntervalMs / MILLISECONDS_PER_SECOND,
            ],
        );

        return {
            priceBucketSize: grid.priceBucketSize,
            sampleIntervalMs,
            frames: rows.map(toLiquidityFrame),
        };
    }

    /**
     * Frames recorded after an instant, for a live tail.
     *
     * @param query - Instrument, exclusive lower bound, and row cap.
     * @returns Frames in capture order, at their stored resolution.
     * @throws PostgresQueryError when the read fails.
     */
    async fetchFramesAfter(query: FrameTailQuery): Promise<LiquidityFrameWindow> {
        const rows = await this.postgres.selectRows<LiquidityFrameRow>(
            `SELECT ${FRAME_COLUMNS}
             FROM liquidity_frame frame
             WHERE frame.instrument_symbol = $1 AND frame.captured_at > $2
             ORDER BY frame.captured_at ASC
             LIMIT $3`,
            [query.symbol, new Date(query.afterMs), query.maxFrames],
        );

        const grid = await this.resolveInstrumentGrid(query.symbol);
        return {
            priceBucketSize: grid.priceBucketSize,
            sampleIntervalMs: grid.frameIntervalMs,
            frames: rows.map(toLiquidityFrame),
        };
    }

    /**
     * Executions across a time range, binned onto the requested time and price grid.
     *
     * @param query - Instrument, time range, column budget, and price binning.
     * @returns Clusters ordered by time then price, on the binned grid.
     * @throws PostgresQueryError when the read fails.
     */
    async fetchTradeClusters(query: TradeClusterQuery): Promise<TradeClusterWindow> {
        const grid = await this.resolveInstrumentGrid(query.symbol);
        const sampleIntervalMs = Math.max(resolveSampleInterval(query), grid.frameIntervalMs);
        const source = selectTradeSource(sampleIntervalMs);

        const rows = await this.postgres.selectRows<TradeClusterRow>(
            `SELECT
                 time_bucket(make_interval(secs => $4), executed_at)  AS bucket_start,
                 floor(price_bucket_index::numeric / $5)::int         AS grouped_bucket_index,
                 SUM(buy_quantity)::double precision                  AS buy_quantity,
                 SUM(sell_quantity)::double precision                 AS sell_quantity,
                 SUM(trade_count)::int                                AS trade_count,
                 MAX(largest_trade_quantity)::double precision        AS largest_trade_quantity
             FROM ${source.table}
             WHERE instrument_symbol = $1 AND executed_at >= $2 AND executed_at < $3
             GROUP BY 1, 2
             HAVING SUM(buy_quantity) + SUM(sell_quantity) >= $6
             ORDER BY 1, 2
             LIMIT $7`,
            [
                query.symbol,
                new Date(query.fromMs),
                new Date(query.toMs),
                sampleIntervalMs / MILLISECONDS_PER_SECOND,
                query.priceGroupSize,
                query.minimumQuantity,
                query.maxClusters,
            ],
        );

        return {
            priceBucketSize: grid.priceBucketSize * query.priceGroupSize,
            sampleIntervalMs,
            clusters: rows.map(toTradeCluster),
        };
    }

    /**
     * Unrecorded windows overlapping a time range.
     *
     * @param query - Instrument and half-open time range; the column budget is ignored.
     * @returns Gaps ordered by start instant.
     * @throws PostgresQueryError when the read fails.
     */
    async fetchGaps(query: WindowQuery): Promise<RecordingGap[]> {
        const rows = await this.postgres.selectRows<RecordingGapRow>(
            `SELECT gap_started_at, gap_ended_at, gap_reason
             FROM recording_gap
             WHERE instrument_symbol = $1 AND gap_ended_at >= $2 AND gap_started_at < $3
             ORDER BY gap_started_at ASC`,
            [query.symbol, new Date(query.fromMs), new Date(query.toMs)],
        );

        return rows.map(toRecordingGap);
    }

    private async resolveInstrumentGrid(instrumentSymbol: string): Promise<InstrumentGrid> {
        const rows = await this.postgres.selectRows<{
            price_bucket_size: number;
            frame_interval_ms: number;
        }>(
            `SELECT price_bucket_size, frame_interval_ms
             FROM instrument_registry
             WHERE instrument_symbol = $1`,
            [instrumentSymbol],
        );

        const row = rows[0];
        if (row === undefined) {
            throw new Error(`Instrument ${instrumentSymbol} has never been recorded`);
        }
        return {
            priceBucketSize: row.price_bucket_size,
            frameIntervalMs: Math.max(1, row.frame_interval_ms),
        };
    }
}

function resolveSampleInterval(query: WindowQuery): number {
    const rangeMs = Math.max(1, query.toMs - query.fromMs);
    return Math.max(1, Math.ceil(rangeMs / Math.max(1, query.maxColumns)));
}

function selectTradeSource(sampleIntervalMs: number): TradeSource {
    let selected: TradeSource = TRADE_SOURCES[0];
    for (const candidate of TRADE_SOURCES) {
        if (candidate.nativeIntervalMs <= sampleIntervalMs) {
            selected = candidate;
        }
    }
    return selected;
}
