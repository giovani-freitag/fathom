import { resolveSampleInterval } from '../../shared/core/window-grid.ts';
import type { InstrumentCoverage, TradeClusterQuery, WindowQuery } from '../../shared/core/api-contract.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeClusterWindow } from '../../shared/core/trade-cluster.ts';
import type { PostgresService } from '../postgres/postgres-service.ts';
import type { ChunkRowStore } from '../core/chunk-row-store.ts';
import {
    type RecordingGapRow,
    toRecordingGap,
    toTradeCluster,
    type TradeClusterRow,
} from '../postgres/postgres-row-mapping.ts';

const MILLISECONDS_PER_SECOND = 1_000;

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
    /** Where the recording is, for the coverage a listing carries. */
    readonly chunks: ChunkRowStore;
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
 */
export class LiquidityQueryService {
    private readonly postgres: PostgresService;
    private readonly chunks: ChunkRowStore;

    constructor(config: LiquidityQueryServiceConfig) {
        this.postgres = config.postgres;
        this.chunks = config.chunks;
    }

    /**
     * Every instrument a collector has registered, with its recorded extent.
     *
     * @returns Coverage per instrument, ordered by symbol.
     * @throws PostgresQueryError when the read fails.
     */
    async listInstruments(): Promise<InstrumentCoverage[]> {
        const rows = await this.postgres.selectRows<{
            instrument_symbol: string;
            price_bucket_size: number;
            frame_interval_ms: number;
        }>(`
            SELECT instrument_symbol, price_bucket_size, frame_interval_ms
            FROM instrument_registry ORDER BY instrument_symbol`);

        // Coverage out of the archive the chart reads, not out of a second
        // store kept beside it. A registry entry with nothing recorded against
        // it is a contract that was switched on and has not been captured yet,
        // which is a real answer and not an omission.
        const covered = await Promise.all(rows.map(
            (row) => this.chunks.readCoverage(row.instrument_symbol),
        ));

        return rows.map((row, index) => {
            const coverage = covered[index] ?? null;
            return {
                instrumentSymbol: row.instrument_symbol,
                priceBucketSize: row.price_bucket_size,
                frameIntervalMs: row.frame_interval_ms,
                firstFrameAtMs: coverage?.firstFrameAtMs ?? null,
                lastFrameAtMs: coverage?.lastFrameAtMs ?? null,
                lastMidPrice: coverage?.lastMidPrice ?? null,
            };
        });
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


function selectTradeSource(sampleIntervalMs: number): TradeSource {
    let selected: TradeSource = TRADE_SOURCES[0];
    for (const candidate of TRADE_SOURCES) {
        if (candidate.nativeIntervalMs <= sampleIntervalMs) {
            selected = candidate;
        }
    }
    return selected;
}




