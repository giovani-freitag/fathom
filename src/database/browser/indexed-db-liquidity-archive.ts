import {
    ArchiveUnavailableError,
    type FrameAppendRequest,
    type GapRecordRequest,
    type InstrumentRegistrationRequest,
    type LiquidityArchive,
    type TradeClusterAppendRequest,
} from '../services/liquidity-archive.ts';
import type { FrameRecord } from './indexed-db-record-mapping.ts';
import { IndexedDbQueryError, type IndexedDbService } from './indexed-db-service.ts';
import { STORES } from './browser-schema.ts';
import {
    toFrameRecord,
    toTradeClusterRecord,
} from './indexed-db-record-mapping.ts';

export interface IndexedDbLiquidityArchiveConfig {
    readonly database: IndexedDbService;
    /** Newest frames kept before the oldest are dropped. */
    readonly frameCapacity: number;
}

/** How many frames are dropped per prune, so one pass never stalls a paint. */
const PRUNE_BATCH_FRAMES = 600;

/**
 * The browser's write side, keeping the newest window and dropping the rest.
 */
export class IndexedDbLiquidityArchive implements LiquidityArchive {
    private readonly database: IndexedDbService;
    private readonly frameCapacity: number;

    constructor(config: IndexedDbLiquidityArchiveConfig) {
        this.database = config.database;
        this.frameCapacity = Math.max(1, config.frameCapacity);
    }

    async open(): Promise<void> {
        await this.database.open();
    }

    async close(): Promise<void> {
        this.database.close();
        return Promise.resolve();
    }

    /**
     * Records the grid an instrument is being captured on.
     *
     * @param request - The instrument and its grid.
     * @throws ArchiveUnavailableError when the write is refused.
     */
    async registerInstrument(request: InstrumentRegistrationRequest): Promise<void> {
        await this.write([STORES.instrumentRegistry], ([registry]) => {
            registry!.put({ ...request, registeredAtMs: Date.now() });
        });
    }

    /**
     * Appends captured frames.
     *
     * @param request - The instrument, its grid, and the frames.
     * @throws ArchiveUnavailableError when the write is refused.
     */
    async appendFrames(request: FrameAppendRequest): Promise<void> {
        if (request.frames.length === 0) {
            return;
        }
        await this.write([STORES.liquidityFrame], ([frames]) => {
            for (const frame of request.frames) {
                frames!.put(toFrameRecord(request.instrumentSymbol, request.priceBucketSize, frame));
            }
        });
    }

    /**
     * Appends aggregated executions.
     *
     * @param request - The instrument, its grid, and the clusters.
     * @throws ArchiveUnavailableError when the write is refused.
     */
    async appendTradeClusters(request: TradeClusterAppendRequest): Promise<void> {
        if (request.clusters.length === 0) {
            return;
        }
        await this.write([STORES.tradeCluster], ([clusters]) => {
            for (const cluster of request.clusters) {
                clusters!.put(
                    toTradeClusterRecord(request.instrumentSymbol, request.priceBucketSize, cluster),
                );
            }
        });
    }

    /**
     * Records a stretch that went unrecorded.
     *
     * @param request - The instrument and the gap.
     * @throws ArchiveUnavailableError when the write is refused.
     */
    async recordGap(request: GapRecordRequest): Promise<void> {
        await this.write([STORES.recordingGap], ([gaps]) => {
            gaps!.put({ instrumentSymbol: request.instrumentSymbol, ...request.gap });
        });
    }

    /**
     * Instant of the newest recorded frame.
     *
     * @param instrumentSymbol - Which contract.
     * @returns The instant, or null when nothing is stored.
     */
    async findLastFrameTimestamp(instrumentSymbol: string): Promise<number | null> {
        let newest: number | null = null;
        await this.database.transact([STORES.liquidityFrame], 'readonly', ([frames]) => {
            const request = frames!.openCursor(rangeForInstrument(instrumentSymbol), 'prev');
            request.onsuccess = () => {
                const cursor = request.result;
                newest = cursor === null ? null : (cursor.value as FrameRecord).capturedAtMs;
            };
        });
        return newest;
    }

    /**
     * Drops the oldest frames once the window is longer than it may be.
     *
     * @param instrumentSymbol - Which contract to trim.
     * @param frameCapacity - Overrides the capacity this archive was built with.
     * @returns How many frames were dropped.
     */
    async pruneToCapacity(instrumentSymbol: string, frameCapacity?: number): Promise<number> {
        const range = rangeForInstrument(instrumentSymbol);
        const stored = await this.database.countRange(STORES.liquidityFrame, range);
        const excess = stored - Math.max(1, frameCapacity ?? this.frameCapacity);
        if (excess <= 0) {
            return 0;
        }

        const dropping = Math.min(excess, PRUNE_BATCH_FRAMES);
        // One record more than is being dropped: the delete below is bounded
        // strictly, so the horizon has to be the first frame that survives.
        // Taking the last of the batch instead left that frame behind, and the
        // count returned still claimed it had gone.
        const batch = await this.database.readRange<FrameRecord>(
            STORES.liquidityFrame,
            range,
            dropping + 1,
        );
        const horizonMs = batch[dropping]?.capturedAtMs;
        if (horizonMs === undefined) {
            return 0;
        }

        // One range delete rather than a cursor: the compound key already sorts
        // by time within an instrument, so everything below the horizon is
        // exactly the oldest, and the engine removes it in a single operation.
        const expired = boundedRange(instrumentSymbol, horizonMs);
        await this.write(
            [STORES.liquidityFrame, STORES.tradeCluster, STORES.recordingGap],
            ([frames, clusters, gaps]) => {
                frames!.delete(expired);
                clusters!.delete(expired);
                this.deleteGapsEndingBefore(gaps!, instrumentSymbol, horizonMs);
            },
        );
        return dropping;
    }

    /**
     * Removes only gaps that ended before the horizon.
     */
    private deleteGapsEndingBefore(
        gaps: IDBObjectStore,
        instrumentSymbol: string,
        horizonMs: number,
    ): void {
        const request = gaps.openCursor(boundedRange(instrumentSymbol, horizonMs));
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor === null) {
                return;
            }
            if ((cursor.value as { gapEndedAtMs: number }).gapEndedAtMs < horizonMs) {
                cursor.delete();
            }
            cursor.continue();
        };
    }

    private async write(
        storeNames: readonly string[],
        work: (stores: readonly IDBObjectStore[]) => void,
    ): Promise<void> {
        try {
            await this.database.transact(storeNames, 'readwrite', work);
        } catch (error) {
            throw new ArchiveUnavailableError(
                'The local archive would not accept the write',
                isQuotaExceeded(error),
                { cause: error },
            );
        }
    }
}

/** Every record of one instrument: `[symbol]` sorts before every `[symbol, n]`. */
function rangeForInstrument(instrumentSymbol: string): IDBKeyRange {
    return IDBKeyRange.bound([instrumentSymbol], [instrumentSymbol, Number.POSITIVE_INFINITY]);
}

/** One instrument's records strictly older than an instant. */
function boundedRange(instrumentSymbol: string, horizonMs: number): IDBKeyRange {
    return IDBKeyRange.bound([instrumentSymbol], [instrumentSymbol, horizonMs], false, true);
}

/**
 * Whether the browser refused because storage is spent.
 */
function isQuotaExceeded(error: unknown): boolean {
    const cause = error instanceof IndexedDbQueryError ? error.cause : error;
    return cause instanceof DOMException && cause.name === 'QuotaExceededError';
}
