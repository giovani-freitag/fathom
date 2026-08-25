import type { LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';
import type { PostgresService } from '../core/postgres-service.ts';
import { buildValuesClause, chunkItems } from '../core/multi-row-insert.ts';

const FRAME_COLUMN_COUNT = 9;
const TRADE_CLUSTER_COLUMN_COUNT = 8;
const FRAMES_PER_STATEMENT = 500;
const TRADE_CLUSTERS_PER_STATEMENT = 800;

export interface LiquidityArchiveServiceConfig {
    readonly postgres: PostgresService;
}

export interface FrameAppendRequest {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frames: readonly LiquidityFrame[];
}

export interface TradeClusterAppendRequest {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly clusters: readonly TradeCluster[];
}

export interface InstrumentRegistrationRequest {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
}

export interface GapRecordRequest {
    readonly instrumentSymbol: string;
    readonly gap: RecordingGap;
}

/**
 * Write side of the recorded market history.
 *
 * Every statement is idempotent on its natural key, so a restart that replays
 * the current second, or a retry of a batch whose failure landed after the
 * commit, converges instead of duplicating columns.
 */
export class LiquidityArchiveService {
    private readonly postgres: PostgresService;

    constructor(config: LiquidityArchiveServiceConfig) {
        this.postgres = config.postgres;
    }

    /**
     * Appends depth frames, ignoring any whose instant is already recorded.
     *
     * @param request - Instrument, price grid, and frames in capture order.
     * @throws PostgresQueryError when the write fails.
     */
    async appendFrames(request: FrameAppendRequest): Promise<void> {
        for (const chunk of chunkItems(request.frames, FRAMES_PER_STATEMENT)) {
            await this.insertFrameChunk(request, chunk);
        }
    }

    /**
     * Appends aggregated executions, ignoring any cell already recorded.
     *
     * @param request - Instrument, price grid, and clusters in execution order.
     * @throws PostgresQueryError when the write fails.
     */
    async appendTradeClusters(request: TradeClusterAppendRequest): Promise<void> {
        for (const chunk of chunkItems(request.clusters, TRADE_CLUSTERS_PER_STATEMENT)) {
            await this.insertTradeClusterChunk(request, chunk);
        }
    }

    /**
     * Declares the grid an instrument is being recorded on.
     *
     * The viewer needs the list of recorded contracts on every load; deriving it
     * from the frames would mean a distinct scan over the whole hypertable.
     *
     * @param request - Instrument symbol and the grid the collector will use.
     * @throws PostgresQueryError when the write fails.
     */
    async registerInstrument(request: InstrumentRegistrationRequest): Promise<void> {
        await this.postgres.execute(
            `INSERT INTO instrument_registry (instrument_symbol, price_bucket_size, frame_interval_ms)
             VALUES ($1, $2, $3)
             ON CONFLICT (instrument_symbol) DO UPDATE
             SET price_bucket_size = EXCLUDED.price_bucket_size,
                 frame_interval_ms = EXCLUDED.frame_interval_ms`,
            [request.instrumentSymbol, request.priceBucketSize, request.frameIntervalMs],
        );
    }

    /**
     * Records a window during which nothing was captured.
     *
     * @param request - Instrument and the gap's bounds and cause.
     * @throws PostgresQueryError when the write fails.
     */
    async recordGap(request: GapRecordRequest): Promise<void> {
        await this.postgres.execute(
            `INSERT INTO recording_gap (gap_started_at, gap_ended_at, instrument_symbol, gap_reason)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (instrument_symbol, gap_started_at) DO NOTHING`,
            [
                new Date(request.gap.gapStartedAtMs),
                new Date(request.gap.gapEndedAtMs),
                request.instrumentSymbol,
                request.gap.gapReason,
            ],
        );
    }

    /**
     * Instant of the newest recorded frame for an instrument.
     *
     * A collector starting up reads this to learn where its last run stopped,
     * which is the only way the downtime in between can be recorded as a gap.
     *
     * @param instrumentSymbol - Contract to look up.
     * @returns Unix milliseconds of the newest frame, or null when none exist.
     * @throws PostgresQueryError when the read fails.
     */
    async findLastFrameTimestamp(instrumentSymbol: string): Promise<number | null> {
        const rows = await this.postgres.selectRows<{ last_captured_at: Date | null }>(
            `SELECT MAX(captured_at) AS last_captured_at
             FROM liquidity_frame
             WHERE instrument_symbol = $1`,
            [instrumentSymbol],
        );
        const lastCapturedAt = rows[0]?.last_captured_at ?? null;
        return lastCapturedAt === null ? null : lastCapturedAt.getTime();
    }

    private async insertFrameChunk(
        request: FrameAppendRequest,
        frames: readonly LiquidityFrame[],
    ): Promise<void> {
        const parameters: unknown[] = [];
        for (const frame of frames) {
            parameters.push(
                new Date(frame.capturedAtMs),
                request.instrumentSymbol,
                request.priceBucketSize,
                frame.bestBidPrice,
                frame.bestAskPrice,
                frame.bids.lowestBucketIndex,
                Array.from(frame.bids.quantities),
                frame.asks.lowestBucketIndex,
                Array.from(frame.asks.quantities),
            );
        }

        await this.postgres.execute(
            `INSERT INTO liquidity_frame (
                 captured_at, instrument_symbol, price_bucket_size,
                 best_bid_price, best_ask_price,
                 bid_lowest_bucket_index, bid_quantities,
                 ask_lowest_bucket_index, ask_quantities
             ) VALUES ${buildValuesClause(frames.length, FRAME_COLUMN_COUNT)}
             ON CONFLICT DO NOTHING`,
            parameters,
        );
    }

    private async insertTradeClusterChunk(
        request: TradeClusterAppendRequest,
        clusters: readonly TradeCluster[],
    ): Promise<void> {
        const parameters: unknown[] = [];
        for (const cluster of clusters) {
            parameters.push(
                new Date(cluster.executedAtMs),
                request.instrumentSymbol,
                request.priceBucketSize,
                cluster.priceBucketIndex,
                cluster.buyQuantity,
                cluster.sellQuantity,
                cluster.tradeCount,
                cluster.largestTradeQuantity,
            );
        }

        await this.postgres.execute(
            `INSERT INTO trade_cluster (
                 executed_at, instrument_symbol, price_bucket_size, price_bucket_index,
                 buy_quantity, sell_quantity, trade_count, largest_trade_quantity
             ) VALUES ${buildValuesClause(clusters.length, TRADE_CLUSTER_COLUMN_COUNT)}
             ON CONFLICT DO NOTHING`,
            parameters,
        );
    }
}
