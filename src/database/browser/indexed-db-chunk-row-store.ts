import type {
    ChunkBlockAddress,
    ChunkBlockRange,
    ChunkBlockRow,
    ChunkBlockWrite,
    ChunkRowStore,
    ChunkSquareQuery,
    ChunkSquareRow,
    ChunkSquareWrite,
    FinestChunkGrid,
} from '../core/chunk-row-store.ts';
import { firstRecordedInstant } from '../core/chunk-row-store.ts';
import type { IndexedDbService } from './indexed-db-service.ts';
import { BLOCK_REACH_INDEX, STORES } from './browser-schema.ts';

/** One block as it is kept, its address folded in because that is its key. */
interface BlockRecord extends ChunkBlockAddress {
    readonly endedAtMs: number;
    readonly columnIntervalMs: number;
    readonly priceBucketSize: number;
    readonly columnCount: number;
    readonly stepRatio: number;
    readonly smallestQuantity: number;
    readonly bestBidPrices: number[];
    readonly bestAskPrices: number[];
    /** Changes on every write, so one writer can tell its own from another's. */
    readonly revision: string;
}

/** One square as it is kept. */
interface SquareRecord extends ChunkBlockAddress {
    readonly lowestBucketIndex: number;
    readonly columnCount: number;
    readonly lowPlane: Uint8Array;
    readonly highPlane: Uint8Array | null;
    /** False where the browser had nothing to squeeze the planes with. */
    readonly isSqueezed: boolean;
}

export interface IndexedDbChunkRowStoreConfig {
    readonly database: IndexedDbService;
}

/**
 * The squares of the whole book, kept in a page rather than on a server.
 *
 * Planes are squeezed with gzip on the way in and opened on the way out. A page
 * has no brotli, and unsqueezed they are dear: measured on a recorded book, a
 * minute and a half of one contract left nine and a half megabytes in the
 * store, which is some twenty-nine megabytes an hour and more than a browser
 * should be asked to hold for a demo. Gzip is asynchronous where brotli is not,
 * which costs nothing here because storing a square already is.
 *
 * A browser without `CompressionStream` keeps the bytes as they are rather than
 * refusing to record. Each square says which of the two it is, so a store
 * written by one and read by the other still opens.
 *
 * The grid, the levels and the addressing are the server's, exactly: this keeps
 * rows, and every decision about what a row means is made above it.
 */
export class IndexedDbChunkRowStore implements ChunkRowStore {
    private readonly config: IndexedDbChunkRowStoreConfig;
    /** Tells this store's writes from another's, and each of its own apart. */
    private readonly writer = Math.random().toString(36).slice(2, 10);
    private stamp = 0;

    constructor(config: IndexedDbChunkRowStoreConfig) {
        this.config = config;
    }

    async readBlock(at: ChunkBlockAddress): Promise<ChunkBlockRow | null> {
        const record = await this.readBlockRecord(at);
        return record === null ? null : toBlockRow(record);
    }

    async readBlocksWithin(range: ChunkBlockRange): Promise<readonly ChunkBlockRow[]> {
        const found: BlockRecord[] = [];
        await this.config.database.transact([STORES.liquidityBlock], 'readonly', ([store]) => {
            // Off the index over the instant a block reaches, so the walk starts
            // at the first block the window can contain rather than at the first
            // block of the level. It stops at the first one opening past the
            // window, which is exact: blocks of one level are fixed and never
            // overlap, so reaching order and opening order are one order.
            const request = store!.index(BLOCK_REACH_INDEX).openCursor(IDBKeyRange.bound(
                [range.instrumentSymbol, range.detailLevel, range.fromMs],
                [range.instrumentSymbol, range.detailLevel, Number.MAX_SAFE_INTEGER],
            ));
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor === null) {
                    return;
                }
                const record = cursor.value as BlockRecord;
                if (record.startedAtMs > range.toMs) {
                    return;
                }
                found.push(record);
                cursor.continue();
            };
        });
        return found.map(toBlockRow);
    }

    async readFinestReach(
        range: Omit<ChunkBlockRange, 'detailLevel'>,
    ): Promise<number | null> {
        const blocks = await this.readBlocksWithin({ ...range, detailLevel: 0 });
        const recorded = blocks
            .map(firstRecordedInstant)
            .filter((one): one is number => one !== null);
        return recorded.length === 0 ? null : Math.min(...recorded);
    }

    async readFinestGrid(instrumentSymbol: string): Promise<FinestChunkGrid | null> {
        const newest: BlockRecord[] = [];
        await this.config.database.transact([STORES.liquidityBlock], 'readonly', ([store]) => {
            // Backwards from the newest and stopped at the first, rather than
            // every block of the level read to keep its last.
            const request = store!.openCursor(IDBKeyRange.bound(
                [instrumentSymbol, 0],
                [instrumentSymbol, 0, Number.MAX_SAFE_INTEGER],
            ), 'prev');
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor !== null) {
                    newest.push(cursor.value as BlockRecord);
                }
            };
        });
        const found = newest[0];
        return found === undefined
            ? null
            : { columnIntervalMs: found.columnIntervalMs, priceBucketSize: found.priceBucketSize };
    }

    async readRevision(at: ChunkBlockAddress): Promise<string | null> {
        // The whole block would come with the touch prices of five hundred and
        // twelve instants attached, and this is asked before every write of
        // every level. The key alone is what a store can answer cheaply.
        let revision: string | null = null;
        await this.config.database.transact([STORES.liquidityBlock], 'readonly', ([store]) => {
            const request = store!.get([at.instrumentSymbol, at.detailLevel, at.startedAtMs]);
            request.onsuccess = () => {
                revision = (request.result as { revision?: string } | undefined)?.revision ?? null;
            };
        });
        return revision;
    }

    async writeBlock(write: ChunkBlockWrite): Promise<string | null> {
        const { row } = write;
        this.stamp += 1;
        const revision = `${this.writer}-${String(this.stamp)}`;
        const record: BlockRecord = {
            instrumentSymbol: write.instrumentSymbol,
            detailLevel: write.detailLevel,
            startedAtMs: row.startedAtMs,
            endedAtMs: write.endedAtMs,
            columnIntervalMs: row.columnIntervalMs,
            priceBucketSize: row.priceBucketSize,
            columnCount: row.columnCount,
            stepRatio: row.stepRatio,
            smallestQuantity: row.smallestQuantity,
            bestBidPrices: [...row.bestBidPrices],
            bestAskPrices: [...row.bestAskPrices],
            revision,
        };
        await this.config.database.transact([STORES.liquidityBlock], 'readwrite', ([store]) => {
            store!.put(record);
        });
        return revision;
    }

    async writeSquare(write: ChunkSquareWrite): Promise<void> {
        const { row } = write;
        const record: SquareRecord = {
            instrumentSymbol: write.instrumentSymbol,
            detailLevel: write.detailLevel,
            startedAtMs: row.startedAtMs,
            lowestBucketIndex: row.lowestBucketIndex,
            columnCount: row.columnCount,
            lowPlane: await squeezePlane(row.lowPlane),
            highPlane: row.highPlane === null ? null : await squeezePlane(row.highPlane),
            isSqueezed: canSqueeze(),
        };
        await this.config.database.transact([STORES.liquidityChunk], 'readwrite', ([store]) => {
            store!.put(record);
        });
    }

    async readSquares(query: ChunkSquareQuery): Promise<readonly ChunkSquareRow[]> {
        const records: SquareRecord[] = [];
        // One transaction for every block, rather than one apiece: the squares
        // of a window are read together, and a page pays for each transaction it
        // opens. The named ones are fetched by their own keys, which is what the
        // band is for — a square not crossed is never read, let alone opened.
        await this.config.database.transact([STORES.liquidityChunk], 'readonly', ([store]) => {
            const gather = (request: IDBRequest<unknown>): void => {
                request.onsuccess = () => {
                    const found = request.result as SquareRecord | undefined;
                    if (found !== undefined) {
                        records.push(found);
                    }
                };
            };
            for (const startedAtMs of query.startedAtMs) {
                if (query.lowestBucketIndexes === null) {
                    const walk = store!.openCursor(IDBKeyRange.bound(
                        [query.instrumentSymbol, query.detailLevel, startedAtMs],
                        [query.instrumentSymbol, query.detailLevel, startedAtMs,
                            Number.MAX_SAFE_INTEGER],
                    ));
                    walk.onsuccess = () => {
                        const cursor = walk.result;
                        if (cursor === null) {
                            return;
                        }
                        records.push(cursor.value as SquareRecord);
                        cursor.continue();
                    };
                    continue;
                }
                for (const lowestBucketIndex of query.lowestBucketIndexes) {
                    gather(store!.get([
                        query.instrumentSymbol, query.detailLevel, startedAtMs, lowestBucketIndex,
                    ]));
                }
            }
        });

        // Opened after the transaction rather than inside it: a plane is
        // gunzipped through a stream, and a transaction that awaits anything
        // that is not its own request is closed by the time it resumes.
        const found: ChunkSquareRow[] = [];
        for (const record of records) {
            found.push({
                startedAtMs: record.startedAtMs,
                lowestBucketIndex: record.lowestBucketIndex,
                columnCount: record.columnCount,
                lowPlane: await openPlane(record.lowPlane, record.isSqueezed),
                highPlane: record.highPlane === null
                    ? null
                    : await openPlane(record.highPlane, record.isSqueezed),
            });
        }
        return found;
    }

    /** One stored block, or null where the page never recorded it. */
    private async readBlockRecord(at: ChunkBlockAddress): Promise<BlockRecord | null> {
        let found: BlockRecord | null = null;
        await this.config.database.transact([STORES.liquidityBlock], 'readonly', ([store]) => {
            const request = store!.get([at.instrumentSymbol, at.detailLevel, at.startedAtMs]);
            request.onsuccess = () => { found = (request.result as BlockRecord | undefined) ?? null; };
        });
        return found;
    }
}

/** Whether this browser can squeeze a plane at all. */
function canSqueeze(): boolean {
    return typeof CompressionStream === 'function';
}

/**
 * One plane on its way into the store, squeezed where the browser can.
 *
 * @param plane - One byte per cell, as the packer laid it out.
 * @returns The bytes to store, copied so nothing the packer reuses is kept.
 */
async function squeezePlane(plane: Uint8Array): Promise<Uint8Array> {
    if (!canSqueeze()) {
        // Copied rather than referenced: the planes are built once per write and
        // handed on, and a stored record holding a view of a buffer the packer
        // reuses is a square that changes after it was stored.
        return Uint8Array.from(plane);
    }
    return pipeThrough(plane, new CompressionStream('gzip'));
}

/**
 * One stored plane, back to one byte per cell.
 *
 * @param stored - The bytes as they were kept.
 * @param isSqueezed - Whether the browser that wrote them could squeeze.
 * @returns The plane.
 */
async function openPlane(stored: Uint8Array, isSqueezed: boolean): Promise<Uint8Array> {
    return isSqueezed ? pipeThrough(stored, new DecompressionStream('gzip')) : stored;
}

/** Runs bytes through one of the browser's own streams and gathers the result. */
async function pipeThrough(
    bytes: Uint8Array,
    stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
    const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(piped).arrayBuffer());
}

/** One stored block in the shape the archive above reasons in. */
function toBlockRow(record: BlockRecord): ChunkBlockRow {
    return {
        startedAtMs: record.startedAtMs,
        columnIntervalMs: record.columnIntervalMs,
        priceBucketSize: record.priceBucketSize,
        columnCount: record.columnCount,
        stepRatio: record.stepRatio,
        smallestQuantity: record.smallestQuantity,
        bestBidPrices: record.bestBidPrices,
        bestAskPrices: record.bestAskPrices,
    };
}
