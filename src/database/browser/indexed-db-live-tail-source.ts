import type {
    BetweenRequest,
    FramesAfterRequest,
    LiveTailSource,
} from '../../shared/core/live-tail.ts';
import type { FrameRecord, GapRecord, InstrumentRecord, TradeClusterRecord } from './indexed-db-record-mapping.ts';
import { toLiquidityFrame, toRecordingGap, toTradeCluster } from './indexed-db-record-mapping.ts';
import type { IndexedDbService } from './indexed-db-service.ts';
import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import { STORES } from './browser-schema.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';

export interface IndexedDbLiveTailSourceConfig {
    readonly database: IndexedDbService;
}

/**
 * The reads a tail makes, answered from the store this page records into.
 */
export class IndexedDbLiveTailSource implements LiveTailSource {
    private readonly database: IndexedDbService;

    constructor(config: IndexedDbLiveTailSourceConfig) {
        this.database = config.database;
    }

    /**
     * Frames recorded after an instant.
     *
     * @param request - The instrument, the cursor, and how many to carry.
     * @returns The frames, oldest first, on the grid they were recorded on.
     */
    async fetchFramesAfter(request: FramesAfterRequest): Promise<LiquidityFrameWindow> {
        // Bounded open at the low end, which is what "strictly after" means on a
        // compound key: the reader already holds the frame at the cursor.
        const range = IDBKeyRange.bound(
            [request.symbol, request.afterMs],
            [request.symbol, Number.POSITIVE_INFINITY],
            true,
            false,
        );
        const records = await this.database.readRange<FrameRecord>(
            STORES.liquidityFrame,
            range,
            request.maxFrames,
        );
        const grid = await this.readGrid(request.symbol);

        return {
            priceBucketSize: grid?.priceBucketSize ?? 1,
            sampleIntervalMs: grid?.frameIntervalMs ?? 1,
            frames: records.map(toLiquidityFrame),
        };
    }

    /**
     * Executions in a half-open range.
     *
     * @param request - The instrument and the range.
     * @returns The clusters, oldest first.
     */
    async fetchTradeClustersBetween(request: BetweenRequest): Promise<readonly TradeCluster[]> {
        const records = await this.database.readRange<TradeClusterRecord>(
            STORES.tradeCluster,
            IDBKeyRange.bound(
                [request.symbol, request.fromMs],
                [request.symbol, request.toMs, Number.POSITIVE_INFINITY],
                true,
                true,
            ),
        );
        return records.map(toTradeCluster);
    }

    /**
     * Stretches in a half-open range that went unrecorded.
     *
     * @param request - The instrument and the range.
     * @returns The gaps that ended inside it.
     */
    async fetchGapsBetween(request: BetweenRequest): Promise<readonly RecordingGap[]> {
        const records = await this.database.readRange<GapRecord>(
            STORES.recordingGap,
            IDBKeyRange.bound([request.symbol], [request.symbol, request.toMs], false, true),
        );
        return records
            .filter((record) => record.gapEndedAtMs > request.fromMs)
            .map(toRecordingGap);
    }

    private async readGrid(instrumentSymbol: string): Promise<InstrumentRecord | null> {
        const registered = await this.database.readRange<InstrumentRecord>(
            STORES.instrumentRegistry,
            IDBKeyRange.only(instrumentSymbol),
        );
        return registered[0] ?? null;
    }
}
