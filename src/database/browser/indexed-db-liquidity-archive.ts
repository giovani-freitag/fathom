import {
    ArchiveUnavailableError,
    type GapRecordRequest,
    type InstrumentRegistrationRequest,
    type LiquidityArchive,
    type TradeClusterAppendRequest,
} from '../services/liquidity-archive.ts';
import { IndexedDbQueryError, type IndexedDbService } from './indexed-db-service.ts';
import type { ChunkRowStore } from '../core/chunk-row-store.ts';
import { STORES } from './browser-schema.ts';
import {
    toTradeClusterRecord,
} from './indexed-db-record-mapping.ts';

export interface IndexedDbLiquidityArchiveConfig {
    readonly database: IndexedDbService;
    /** Where the recording is, for reading how far it reaches. */
    readonly chunks: ChunkRowStore;
    /** Newest instants kept before the oldest are dropped. */
    readonly frameCapacity?: number;
}

/** Instants kept when nothing says otherwise: a little over an hour. */
const DEFAULT_CAPACITY = 4_000;

/** How much time one recorded instant stands for. */
const INSTANT_MS = 1_000;

/**
 * The browser's write side, keeping the newest window and dropping the rest.
 */
/** Which squares a prune is dropping, and the stores holding them. */
interface SquarePrune {
    readonly blocks: IDBObjectStore;
    readonly squares: IDBObjectStore;
    readonly instrumentSymbol: string;
    readonly horizonMs: number;
}

export class IndexedDbLiquidityArchive implements LiquidityArchive {
    private readonly database: IndexedDbService;
    private readonly chunks: ChunkRowStore;
    private readonly frameCapacity: number;

    constructor(config: IndexedDbLiquidityArchiveConfig) {
        this.database = config.database;
        this.chunks = config.chunks;
        this.frameCapacity = Math.max(1, config.frameCapacity ?? DEFAULT_CAPACITY);
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
     * Instant of the newest recorded instant.
     *
     * @param instrumentSymbol - Which contract.
     * @returns The instant, or null when nothing is stored.
     */
    async findLastFrameTimestamp(instrumentSymbol: string): Promise<number | null> {
        const coverage = await this.chunks.readCoverage(instrumentSymbol);
        return coverage?.lastFrameAtMs ?? null;
    }

    /**
     * Drops the oldest recording once the window is longer than it may be.
     *
     * Bounded in time rather than in stored rows. It always meant a stretch —
     * so many instants at a second each — and the archive it now measures keeps
     * a block of columns rather than a row per instant, so a count of records
     * would be a count of the wrong thing.
     *
     * @param instrumentSymbol - Which contract to trim.
     * @param frameCapacity - Overrides the capacity this archive was built with.
     * @returns How many instants of recording were dropped.
     */
    async pruneToCapacity(instrumentSymbol: string, frameCapacity?: number): Promise<number> {
        const coverage = await this.chunks.readCoverage(instrumentSymbol);
        if (coverage === null) {
            return 0;
        }

        const keptMs = Math.max(1, frameCapacity ?? this.frameCapacity) * INSTANT_MS;
        const horizonMs = coverage.lastFrameAtMs - keptMs;
        const excessMs = horizonMs - coverage.firstFrameAtMs;
        if (excessMs <= 0) {
            return 0;
        }

        // One range delete rather than a cursor: the compound key already sorts
        // by time within an instrument, so everything below the horizon is
        // exactly the oldest, and the engine removes it in a single operation.
        const expired = boundedRange(instrumentSymbol, horizonMs);
        await this.write(
            [
                STORES.tradeCluster, STORES.recordingGap,
                STORES.liquidityBlock, STORES.liquidityChunk,
            ],
            ([clusters, gaps, blocks, squares]) => {
                clusters!.delete(expired);
                this.deleteGapsEndingBefore(gaps!, instrumentSymbol, horizonMs);
                this.deleteSquaresEndingBefore({
                    blocks: blocks!, squares: squares!, instrumentSymbol, horizonMs,
                });
            },
        );
        return Math.round(excessMs / INSTANT_MS);
    }

    /**
     * Removes every block and square wholly older than the horizon.
     *
     * A block is dropped only once the instant it reaches is behind the horizon:
     * one still covering the surviving stretch holds instants a reader can still
     * ask for, and a block is stored whole or not at all.
     */
    private deleteSquaresEndingBefore(prune: SquarePrune): void {
        const { blocks, squares, instrumentSymbol, horizonMs } = prune;
        const request = blocks.openCursor(IDBKeyRange.bound(
            [instrumentSymbol],
            [instrumentSymbol, []],
        ));
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor === null) {
                return;
            }
            const block = cursor.value as {
                detailLevel: number; startedAtMs: number; endedAtMs: number;
            };
            if (block.endedAtMs < horizonMs) {
                squares.delete(IDBKeyRange.bound(
                    [instrumentSymbol, block.detailLevel, block.startedAtMs],
                    [instrumentSymbol, block.detailLevel, block.startedAtMs, []],
                ));
                cursor.delete();
            }
            cursor.continue();
        };
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
