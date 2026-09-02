import type { TradeCluster } from '../../shared/core/trade-cluster.ts';
import type { PostgresService } from '../postgres/postgres-service.ts';
import type { ChunkRowStore } from '../core/chunk-row-store.ts';
import { buildValuesClause, chunkItems } from '../postgres/multi-row-insert.ts';
import type {
    GapRecordRequest,
    InstrumentRegistrationRequest,
    LiquidityArchive,
    TradeClusterAppendRequest,
} from './liquidity-archive.ts';

export type {
    GapRecordRequest,
    InstrumentRegistrationRequest,
    TradeClusterAppendRequest,
} from './liquidity-archive.ts';

const TRADE_CLUSTER_COLUMN_COUNT = 8;
const TRADE_CLUSTERS_PER_STATEMENT = 800;

export interface LiquidityArchiveServiceConfig {
    readonly postgres: PostgresService;
    /** Where the recording is, for the one question about it this answers. */
    readonly chunks: ChunkRowStore;
}

/**
 * Write side of the recorded market history.
 */
export class LiquidityArchiveService implements LiquidityArchive {
    private readonly postgres: PostgresService;
    private readonly chunks: ChunkRowStore;

    constructor(config: LiquidityArchiveServiceConfig) {
        this.postgres = config.postgres;
        this.chunks = config.chunks;
    }

    /**
     * Connects the pool this archive writes through.
     */
    async open(): Promise<void> {
        await this.postgres.connect();
    }

    /**
     * Releases the pool.
     */
    async close(): Promise<void> {
        await this.postgres.close();
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
     * @param instrumentSymbol - Contract to look up.
     * @returns Unix milliseconds of the newest frame, or null when none exist.
     * @throws PostgresQueryError when the read fails.
     */
    async findLastFrameTimestamp(instrumentSymbol: string): Promise<number | null> {
        const coverage = await this.chunks.readCoverage(instrumentSymbol);
        return coverage?.lastFrameAtMs ?? null;
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
