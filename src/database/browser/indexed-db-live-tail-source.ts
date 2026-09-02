import type {
    BetweenRequest,
    TailCompanions,
} from '../../shared/core/live-tail.ts';
import type { GapRecord, InstrumentRecord, TradeClusterRecord } from './indexed-db-record-mapping.ts';
import { toRecordingGap, toTradeCluster } from './indexed-db-record-mapping.ts';
import type { IndexedDbService } from './indexed-db-service.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import { STORES } from './browser-schema.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';

export interface IndexedDbLiveTailSourceConfig {
    readonly database: IndexedDbService;
}

/**
 * The reads a tail makes, answered from the store this page records into.
 */
export class IndexedDbLiveTailSource implements TailCompanions {
    private readonly database: IndexedDbService;

    constructor(config: IndexedDbLiveTailSourceConfig) {
        this.database = config.database;
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
