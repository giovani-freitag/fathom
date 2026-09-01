/**
 * Where the squares of the whole book are kept, whatever is keeping them.
 *
 * The archive above this decides what a square is, which level a window is read
 * off, and which squares a band of prices crosses. None of that is storage: it
 * is the same reasoning whether the rows sit in a hypertable on a server or in
 * an object store inside a page, and written twice it drifts twice.
 *
 * Planes cross this boundary as the bytes they are, one per cell. Squeezing
 * them belongs to the store rather than to the archive, because it is the store
 * that knows what it can do: a server has brotli, a page has neither brotli nor
 * a reason to spend a frame on gzip for a session's recording.
 */

/** Which block: one contract, one level, and where the block opens. */
export interface ChunkBlockAddress {
    readonly instrumentSymbol: string;
    readonly detailLevel: number;
    readonly startedAtMs: number;
}

/** The blocks of one level overlapping a stretch of time. */
export interface ChunkBlockRange {
    readonly instrumentSymbol: string;
    readonly detailLevel: number;
    readonly fromMs: number;
    readonly toMs: number;
}

/** One block of a level: what its columns stand on, and where each touch was. */
export interface ChunkBlockRow {
    readonly startedAtMs: number;
    readonly columnIntervalMs: number;
    readonly priceBucketSize: number;
    readonly columnCount: number;
    readonly stepRatio: number;
    readonly smallestQuantity: number;
    readonly bestBidPrices: readonly number[];
    readonly bestAskPrices: readonly number[];
}

/** One square of a block, its planes as one byte per cell. */
export interface ChunkSquareRow {
    readonly startedAtMs: number;
    readonly lowestBucketIndex: number;
    readonly columnCount: number;
    readonly lowPlane: Uint8Array;
    readonly highPlane: Uint8Array | null;
}

/** A block on its way in, with the instant it ends at already worked out. */
export interface ChunkBlockWrite extends ChunkBlockAddress {
    readonly row: ChunkBlockRow;
    readonly endedAtMs: number;
}

/** A square on its way in, and whether its block is finished being filled. */
export interface ChunkSquareWrite extends ChunkBlockAddress {
    readonly row: ChunkSquareRow;
    /**
     * False while the block is still filling, which is written over later.
     *
     * A store that squeezes may squeeze a draft cheaply and the finished one
     * hard, since a draft is replaced within seconds.
     */
    readonly isComplete: boolean;
}

/** Which squares to read: the blocks they belong to, and the band drawn. */
export interface ChunkSquareQuery {
    readonly instrumentSymbol: string;
    readonly detailLevel: number;
    readonly startedAtMs: readonly number[];
    /** The lowest bucket of each square wanted, or null for every square. */
    readonly lowestBucketIndexes: readonly number[] | null;
}

/** The grid the finest level of one contract was recorded on. */
export interface FinestChunkGrid {
    readonly columnIntervalMs: number;
    readonly priceBucketSize: number;
}

/**
 * The first instant one block actually holds a recording of.
 *
 * A block is addressed by a fixed grid and carries empty places until the
 * recording reaches it, so where it opens is not where it begins. Nought for a
 * touch price is what marks a place nobody recorded: no book ever had one.
 *
 * @param row - The block to look at.
 * @returns The instant, or null when the block holds no recording at all.
 */
export function firstRecordedInstant(row: ChunkBlockRow): number | null {
    const column = row.bestBidPrices.findIndex((price) => price > 0);
    return column < 0 ? null : row.startedAtMs + column * row.columnIntervalMs;
}

/**
 * The rows of the chunked archive, kept by a server or by a page.
 */
export interface ChunkRowStore {
    /**
     * One block, or null where nothing is stored for it.
     *
     * @param at - The block wanted.
     * @returns The block, or null.
     */
    readBlock(at: ChunkBlockAddress): Promise<ChunkBlockRow | null>;

    /**
     * Every block of one level overlapping a stretch, oldest first.
     *
     * @param range - The contract, the level, and the stretch.
     * @returns The blocks, in the order they were recorded.
     */
    readBlocksWithin(range: ChunkBlockRange): Promise<readonly ChunkBlockRow[]>;

    /**
     * The first instant the finest level actually recorded inside a stretch.
     *
     * What a coarse level has to reach back to before it is worth reading. A
     * block is addressed by a fixed grid and carries empty places until the
     * recording reaches it, so where the block opens is not where it begins.
     *
     * @param range - The contract and the stretch, at the finest level.
     * @returns The instant, or null where nothing was recorded in it.
     */
    readFinestReach(range: Omit<ChunkBlockRange, 'detailLevel'>): Promise<number | null>;

    /**
     * The grid the finest level of one contract stands on.
     *
     * @param instrumentSymbol - The contract.
     * @returns Its grid, or null where nothing is stored for it.
     */
    readFinestGrid(instrumentSymbol: string): Promise<FinestChunkGrid | null>;

    /**
     * What write the stored block stands on, for telling one writer from another.
     *
     * A block is written whole, so a writer that does not notice another has
     * been in it replaces their work. Something that changes on every write and
     * costs nothing to read is enough to notice.
     *
     * @param at - The block to look at.
     * @returns The mark, or null where nothing is stored there.
     */
    readRevision(at: ChunkBlockAddress): Promise<string | null>;

    /**
     * Stores one block, replacing whatever stood there.
     *
     * @param write - The block, and the instant it reaches.
     * @returns The mark this write left, for telling it apart from another's.
     */
    writeBlock(write: ChunkBlockWrite): Promise<string | null>;

    /**
     * Stores one square of a block, replacing whatever stood there.
     *
     * @param write - The square, and whether its block is finished.
     */
    writeSquare(write: ChunkSquareWrite): Promise<void>;

    /**
     * The squares of the blocks named, narrowed to the band if one was given.
     *
     * Asked for by the blocks themselves rather than by a range around them: a
     * block of the coarsest level spans six days, so any window narrower than
     * that would leave its squares outside it.
     *
     * @param query - The blocks, and the squares of them worth reading.
     * @returns The squares found, in any order.
     */
    readSquares(query: ChunkSquareQuery): Promise<readonly ChunkSquareRow[]>;
}
