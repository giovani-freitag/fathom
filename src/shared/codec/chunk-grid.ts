/**
 * Instants in one chunk, and prices in one chunk.
 *
 * Measured over five hours of a recorded book: the shape of a chunk decides
 * what it compresses to, and the two axes are not alike. Widening it in time
 * from two hundred and fifty-six columns to five hundred and twelve is worth
 * fifteen percent; making it that much taller in price is worth five. A wall
 * stands for hundreds of seconds, so length along time is what the compressor
 * has to work with. Five hundred and twelve on both is the smallest shape that
 * costs less than the band-that-follows-the-price it replaces.
 */
export const COLUMNS_PER_CHUNK = 512;
export const ROWS_PER_CHUNK = 512;

/**
 * How much longer a cell of one level covers than a cell of the one below.
 *
 * Time only — a level folds instants, never prices. The two axes of the chart
 * are zoomed apart, so widening the hours is not a request for coarser prices,
 * and a pyramid that folded both drew a day of the book as seven bands. Four
 * rather than two because the levels then thin out fast enough to be worth
 * keeping: measured, folding time alone costs about eighty percent on top of
 * the finest level for the whole stack.
 */
export const LEVEL_FACTOR = 4;

/**
 * How much coarser than asked a level may be and still be taken.
 *
 * Levels step by four, so a reader who wants a cell of three and a half seconds
 * is refused a four second one and answered off the level below — four times
 * the stored columns to unpack for a tenth more resolution. Measured on a four
 * hour window over the whole book, that cliff was the difference between about
 * two hundred milliseconds and about a second.
 *
 * Two is the point where the level above and the level below are equally far
 * from what was asked for, counted the way the levels step. All it costs is a
 * column at most twice as wide, on a field that is scaled to the plot before
 * anyone sees it — a level folds instants and leaves prices where they are, so
 * there is nothing on the other axis to weigh against it.
 */
const COARSENING_TOLERANCE = 2;

/** How many levels are kept. The coarsest covers a month in one screen. */
export const LEVEL_COUNT = 6;

/** Where one chunk sits, on which level. */
export interface ChunkAddress {
    readonly detailLevel: number;
    /** Index of the block of instants, counted from the epoch. */
    readonly timeBlock: number;
    /** Index of the block of prices, counted from bucket nought. */
    readonly priceBlock: number;
}

/**
 * How many of the finest instants one column of a level covers.
 *
 * @param detailLevel - Nought for the finest.
 * @returns The number of level-nought columns folded into one.
 */
export function columnsPerCell(detailLevel: number): number {
    return LEVEL_FACTOR ** detailLevel;
}

/** What a reader can draw, and the grid the archive recorded on. */
export interface LevelChoice {
    /** How much time is on screen. */
    readonly spanMs: number;
    /** What one instant of the finest level covers. */
    readonly columnIntervalMs: number;
    /** How many columns the reader can draw. */
    readonly maxColumns: number;
}

/**
 * The coarsest level whose cell still fits inside a drawn column.
 *
 * Reading a finer level than the screen can show is paying to decode instants
 * that land on the same pixel. Reading a coarser one draws a cell wider than a
 * column, which is detail the reader asked for and did not get.
 *
 * @param read - The span, the finest grid, and how many columns can be drawn.
 * @returns A level between nought and the coarsest kept.
 */
export function chooseDetailLevel(read: LevelChoice): number {
    const wanted = read.spanMs
        / Math.max(1, read.maxColumns)
        / Math.max(1, read.columnIntervalMs);
    let level = 0;
    while (level + 1 < LEVEL_COUNT && fitsWithin(columnsPerCell(level + 1), wanted)) {
        level += 1;
    }
    return level;
}

/**
 * Whether a level's cell is close enough to what was asked for to be worth it.
 *
 * A cell that fits inside a drawn column is always worth it; one a little wider
 * is worth four times less work.
 */
function fitsWithin(cell: number, wanted: number): boolean {
    return cell <= wanted * COARSENING_TOLERANCE;
}

/**
 * The chunk a price and an instant fall in, on one level.
 *
 * @param detailLevel - The level being addressed.
 * @param columnIndex - The instant, counted in that level's own columns.
 * @param bucketIndex - The price, counted in that level's own buckets.
 * @returns Where the chunk holding them sits.
 */
export function toChunkAddress(
    detailLevel: number,
    columnIndex: number,
    bucketIndex: number,
): ChunkAddress {
    return {
        detailLevel,
        timeBlock: Math.floor(columnIndex / COLUMNS_PER_CHUNK),
        priceBlock: Math.floor(bucketIndex / ROWS_PER_CHUNK),
    };
}

/** The blocks of prices a band of buckets reaches into, lowest first. */
export function priceBlocksAcross(lowestBucketIndex: number, bucketCount: number): number[] {
    const first = Math.floor(lowestBucketIndex / ROWS_PER_CHUNK);
    const last = Math.floor((lowestBucketIndex + Math.max(0, bucketCount - 1)) / ROWS_PER_CHUNK);
    const blocks: number[] = [];
    for (let block = first; block <= last; block += 1) {
        blocks.push(block);
    }
    return blocks;
}

/**
 * The instant a level's column index stands for.
 *
 * @param detailLevel - The level the index is counted in.
 * @param columnIndex - The column, counted from the epoch.
 * @param columnIntervalMs - What one instant of the finest level covers.
 * @returns The first instant that column folded.
 */
export function toColumnStartMs(
    detailLevel: number,
    columnIndex: number,
    columnIntervalMs: number,
): number {
    return columnIndex * columnsPerCell(detailLevel) * columnIntervalMs;
}

/**
 * Which column of a level an instant falls in.
 *
 * @param detailLevel - The level to count in.
 * @param instantMs - The instant.
 * @param columnIntervalMs - What one instant of the finest level covers.
 * @returns The column index, counted from the epoch.
 */
export function toColumnIndex(
    detailLevel: number,
    instantMs: number,
    columnIntervalMs: number,
): number {
    return Math.floor(instantMs / (columnsPerCell(detailLevel) * Math.max(1, columnIntervalMs)));
}
