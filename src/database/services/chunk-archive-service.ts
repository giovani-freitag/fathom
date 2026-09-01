import { toLadders } from '../../shared/core/frame-fold.ts';
import type {
    ChunkBlockRow,
    ChunkRowStore,
    ChunkSquareRow,
} from '../core/chunk-row-store.ts';
import {
    COLUMNS_PER_CHUNK,
    chooseDetailLevel,
    columnsPerCell,
    priceBlocksAcross,
    ROWS_PER_CHUNK,
} from '../../shared/codec/chunk-grid.ts';
import {
    LARGEST_STEP,
    packTile,
    quantiseQuantity,
    type QuantityScale,
    readQuantisedQuantity,
    readTileColumnRows,
    type TileGrid,
} from '../../shared/codec/tile-codec.ts';
import type { LiquidityFrame, LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import {
    type PriceBand,
    resolveWindowBand,
    toBandRow,
    toFoldedBucketIndex,
} from '../../shared/core/price-band.ts';

/** What the first step of the size scale stands for, matching the other stores. */

export interface ChunkArchiveServiceConfig {
    /** Where the rows are kept — a server's tables, or a page's object stores. */
    readonly rows: ChunkRowStore;
}

/** One stretch of instants, already folded onto one level's own grid. */
export interface ChunkWriteRequest {
    readonly instrumentSymbol: string;
    readonly detailLevel: number;
    /** What one column of this level covers, already multiplied out. */
    readonly columnIntervalMs: number;
    readonly priceBucketSize: number;
    /**
     * The scale the columns were quantised on.
     *
     * Handed over rather than assumed here, because the writer is the one that
     * placed the sizes on it. A copy of it kept on this side would be stamped
     * onto the block while the sizes in it were placed on another, and every
     * size in the store would read back wrong by the ratio between the two —
     * silently, since both halves go on working.
     */
    readonly scale: QuantityScale;
    /** The instant the block starts at, snapped onto this level's grid. */
    readonly startedAtMs: number;
    readonly columns: readonly ChunkColumn[];
    /** False while the block is still filling, which is written over later. */
    readonly isComplete: boolean;
}

/** One instant: what rests at each price, and where the touch was. */
export interface ChunkColumn {
    readonly bestBidPrice: number;
    readonly bestAskPrice: number;
    /** Step on the size scale, by the bucket it rests at. */
    readonly steps: ReadonlyMap<number, number>;
}

export interface ChunkWindowQuery {
    readonly instrumentSymbol: string;
    readonly fromMs: number;
    readonly toMs: number;
    readonly maxColumns: number;
    readonly lowPrice?: number;
    readonly highPrice?: number;
    readonly maxRows?: number;
}

/**
 * The heat map as fixed squares, stacked in levels of decreasing detail.
 *
 * The grid does not follow the price. That costs a little where the book is
 * dense and buys the thing the other stores cannot do: a square can be named,
 * so a reader asking for a corner of the chart is handed that corner rather
 * than a stretch of time to decode and discard. It also means a square is the
 * same square between one drag and the next, which is what lets a reader keep
 * the ones it already has.
 */export class ChunkArchiveService {
    private readonly config: ChunkArchiveServiceConfig;

    constructor(config: ChunkArchiveServiceConfig) {
        this.config = config;
    }

    /**
     * What write the stored block stands on, or null when there is none.
     *
     * A block is written whole, so a writer that cannot tell its own last write
     * from someone else's replaces their work without noticing. Reading the
     * block to find out costs between a twentieth and a fifth of a second; this
     * costs a row lookup and opens nothing.
     *
     * @param resume - The block to look at.
     * @returns The mark, or null when nothing is stored there.
     */
    readBlockRevision(resume: BlockResume): Promise<string | null> {
        return this.config.rows.readRevision(resume);
    }

    /**
     * Writes one block of instants and every square it fills.
     *
     * @param request - The level, the grid, and the instants folded onto it.
     * @returns The mark the write left, so the writer can tell its own work
     *          from anyone else's, or null when there was nothing to write.
     */
    async writeBlock(request: ChunkWriteRequest): Promise<string | null> {
        const { columns } = request;
        if (columns.length === 0) {
            return null;
        }

        const revision = await this.config.rows.writeBlock({
            instrumentSymbol: request.instrumentSymbol,
            detailLevel: request.detailLevel,
            startedAtMs: request.startedAtMs,
            endedAtMs: request.startedAtMs + columns.length * request.columnIntervalMs,
            row: {
                startedAtMs: request.startedAtMs,
                columnIntervalMs: request.columnIntervalMs,
                priceBucketSize: request.priceBucketSize,
                columnCount: columns.length,
                stepRatio: request.scale.stepRatio,
                smallestQuantity: request.scale.smallestQuantity,
                bestBidPrices: columns.map((column) => column.bestBidPrice),
                bestAskPrices: columns.map((column) => column.bestAskPrice),
            },
        });

        for (const [priceBlock, steps] of gatherSquares(columns)) {
            await this.writeSquare({ request, priceBlock, steps });
        }
        return revision;
    }

    /**
     * Reads one block back as the columns it holds, for a recorder to carry on from.
     *
     * A block is written whole, so a recorder that started over from an empty
     * one would replace what is stored with what it has gathered since — and a
     * block of the coarsest level spans six days, so a restart would take days
     * of it. Resuming costs one read when a block is opened.
     *
     * @param resume - The instrument, the level, and where the block starts.
     * @returns Its columns, with a hollow one wherever nothing was recorded.
     */
    async readBlock(resume: BlockResume): Promise<ChunkColumn[]> {
        const block = await this.config.rows.readBlock(resume);
        if (block === null) {
            return [];
        }

        const squares = await this.readSquares({
            instrumentSymbol: resume.instrumentSymbol,
            detailLevel: resume.detailLevel,
            startedAt: [block.startedAtMs],
            band: null,
        });
        const opened = openSquares(block, squares);
        return Array.from({ length: block.columnCount }, (_, column) => ({
            bestBidPrice: block.bestBidPrices[column] ?? 0,
            bestAskPrice: block.bestAskPrices[column] ?? 0,
            steps: readColumnSteps(opened, column, block),
        }));
    }

    /**
     * Reads a window back as frames, off whichever level the reader can draw.
     *
     * @param query - Instrument, range, and what the reader can draw.
     * @returns The window, in the shape the chart draws every store in.
     */
    async fetchWindow(query: ChunkWindowQuery): Promise<LiquidityFrameWindow> {
        const finest = await this.config.rows.readFinestGrid(query.instrumentSymbol);
        if (finest === null) {
            return { priceBucketSize: 1, sampleIntervalMs: 1, frames: [] };
        }

        const wanted = chooseDetailLevel({
            spanMs: query.toMs - query.fromMs,
            columnIntervalMs: finest.columnIntervalMs,
            maxColumns: query.maxColumns,
        });
        const found = await this.readBlocks(query, wanted);
        if (found === null) {
            return { priceBucketSize: 1, sampleIntervalMs: 1, frames: [] };
        }
        const { detailLevel, blocks } = found;
        const first = blocks[0]!;

        const band = resolveWindowBand({
            lowPrice: query.lowPrice ?? null,
            highPrice: query.highPrice ?? null,
            maxRows: query.maxRows ?? null,
            priceBucketSize: first.priceBucketSize,
            // The highest touch across the blocks being read, doubled: that is
            // the range the whole-book framing writes. Taken from one column it
            // could be a place nobody recorded, whose touch is nought — and a
            // ceiling of nought is no band at all, so the whole fine grid ships.
            // Taken from the first column of a coarse block it would be months
            // stale, and the top of the book would be cut off invisibly.
            recordedCeiling: highestTouch(blocks) * 2,
        });
        const squares = await this.readSquares({
            instrumentSymbol: query.instrumentSymbol,
            detailLevel,
            startedAt: blocks.map((one) => one.startedAtMs),
            band,
        });

        // A level is four times coarser than the one below it, so the level
        // that fits under the budget can still hold up to four times as many
        // columns as the reader asked for. Measured on a six hour window, that
        // was fourteen thousand columns against a budget of four thousand:
        // decoded, sent, and then thrown away by a chart that has no pixels for
        // them. What is left over is folded here, the same way the levels are.
        const columnStride = strideWithin(query, first.columnIntervalMs);

        const frames: LiquidityFrame[] = [];
        for (const block of blocks) {
            frames.push(...buildFrames({ block, squares, band, query, columnStride }));
        }
        return {
            priceBucketSize: first.priceBucketSize * (band?.bucketsPerRow ?? 1),
            sampleIntervalMs: first.columnIntervalMs * columnStride,
            frames,
        };
    }

    /**
     * The blocks of the level asked for, or of the finest one that has any.
     *
     * A level is only as old as the recording, and the coarse ones fill slowly:
     * a reader zooming out on a young archive would be answered with nothing
     * where a finer level could have answered with everything. Stepping down
     * costs more to decode and is always right; refusing is never right.
     */
    private async readBlocks(query: ChunkWindowQuery, wanted: number): Promise<{
        detailLevel: number; blocks: readonly ChunkBlockRow[];
    } | null> {
        const reachMs = await this.config.rows.readFinestReach(query);
        for (let detailLevel = wanted; detailLevel >= 0; detailLevel -= 1) {
            const blocks = await this.config.rows.readBlocksWithin({ ...query, detailLevel });
            if (blocks.length === 0) {
                continue;
            }
            if (detailLevel === 0 || reachMs === null) {
                return { detailLevel, blocks };
            }
            // Only as far back as the finest level itself goes: a window
            // reaching past the recording is not a level falling short of it.
            const wantedFromMs = Math.max(query.fromMs, reachMs);
            if (firstRecordedMs(blocks) <= wantedFromMs + blocks[0]!.columnIntervalMs) {
                return { detailLevel, blocks };
            }
        }
        return null;
    }

    /** Stores one square, cheaply while its block is still filling. */
    private async writeSquare(write: SquareWrite): Promise<void> {
        const { request, steps } = write;
        const lowestBucketIndex = write.priceBlock * ROWS_PER_CHUNK;
        const grid: TileGrid = {
            rowCount: ROWS_PER_CHUNK,
            columnCount: request.columns.length,
            ...request.scale,
        };
        const planes = packTile(steps.map((column) => {
            const row = new Array<number>(ROWS_PER_CHUNK).fill(0);
            for (const [bucketIndex, step] of column) {
                row[bucketIndex - lowestBucketIndex] = readQuantisedQuantity(step, grid);
            }
            return row;
        }), grid);

        await this.config.rows.writeSquare({
            instrumentSymbol: request.instrumentSymbol,
            detailLevel: request.detailLevel,
            startedAtMs: request.startedAtMs,
            isComplete: request.isComplete,
            row: {
                startedAtMs: request.startedAtMs,
                lowestBucketIndex,
                columnCount: request.columns.length,
                lowPlane: planes.lowPlane,
                highPlane: planes.highPlane,
            },
        });
    }

    /**
     * Every square of the blocks that were found, in the band that is drawn.
     *
     * Keyed by the block they belong to and where they sit in the price, which
     * is how a block picks its own out of a read that covered several.
     */
    private async readSquares(read: SquareRead): Promise<Map<string, ChunkSquareRow>> {
        const { band } = read;
        const wanted = band === null
            ? null
            : priceBlocksAcross(band.lowestBucketIndex, band.bucketCount)
                .map((block) => block * ROWS_PER_CHUNK);
        const rows = await this.config.rows.readSquares({
            instrumentSymbol: read.instrumentSymbol,
            detailLevel: read.detailLevel,
            startedAtMs: read.startedAt,
            lowestBucketIndexes: wanted,
        });

        const found = new Map<string, ChunkSquareRow>();
        for (const row of rows) {
            found.set(`${row.startedAtMs}:${row.lowestBucketIndex}`, row);
        }
        return found;
    }
}

/** Which block a recorder is picking back up. */
export interface BlockResume {
    readonly instrumentSymbol: string;
    readonly detailLevel: number;
    readonly startedAtMs: number;
}

/** Which squares a read wants: the blocks it found, and the band it draws. */
interface SquareRead {
    readonly instrumentSymbol: string;
    readonly detailLevel: number;
    readonly startedAt: readonly number[];
    readonly band: PriceBand | null;
}

/** One square being stored, and the block it belongs to. */
interface SquareWrite {
    readonly request: ChunkWriteRequest;
    readonly priceBlock: number;
    readonly steps: ReadonlyMap<number, number>[];
}

/** One block being read back, and what the reader can draw of it. */
interface BlockRead {
    readonly block: ChunkBlockRow;
    readonly squares: ReadonlyMap<string, ChunkSquareRow>;
    readonly band: PriceBand | null;
    readonly query: ChunkWindowQuery;
    readonly columnStride: number;
}

/** How many stored columns of a level make one drawn column of the window. */
function strideWithin(query: ChunkWindowQuery, columnIntervalMs: number): number {
    const spanColumns = (query.toMs - query.fromMs) / Math.max(1, columnIntervalMs);
    return Math.max(1, Math.ceil(spanColumns / Math.max(1, query.maxColumns)));
}

/** One square, already opened, ready to be read column by column. */
interface OpenSquare {
    readonly lowestBucketIndex: number;
    readonly planes: { lowPlane: Uint8Array; highPlane: Uint8Array | null };
    readonly grid: TileGrid;
}

/** One block's instants, read out of the squares that cover them. */
function buildFrames(read: BlockRead): LiquidityFrame[] {
    const { block, squares, band, query, columnStride } = read;
    const startedAtMs = block.startedAtMs;
    // Opened once for the whole block rather than once per instant. A square is
    // five hundred and twelve prices by as many instants, and unpacking it again
    // for every column of it was the whole cost of a narrow read.
    const opened = openSquares(block, squares);
    const frames: LiquidityFrame[] = [];
    // Anchored to the clock rather than to the block or to the window.
    //
    // To the block, and the columns either side of a boundary sit closer
    // together than the rest, which draws as a seam every five hundred and
    // twelve of them. To the window, and no two reads agree: the same stretch
    // asked for twice, from two different starts, comes back on two grids half
    // a column apart, so a reader who has already got most of what it is asking
    // for can do nothing with it and has to be sent all of it again.
    //
    // Anchored to the clock, every read of a stretch at the same stride lands on
    // the same instants, whatever else it asked for — which is what makes one
    // window and the next fit together.
    const blockStartColumn = Math.round(startedAtMs / block.columnIntervalMs);
    const firstColumn = columnStride >= block.columnCount
        // A stride wider than a whole block would leave blocks out entirely, on
        // an alignment nobody chose. One column from each keeps the window
        // continuous; asking a coarser level instead is what the levels are for.
        ? 0
        : (columnStride - (blockStartColumn % columnStride)) % columnStride;
    for (let column = firstColumn; column < block.columnCount; column += columnStride) {
        const capturedAtMs = startedAtMs + column * block.columnIntervalMs;
        // Judged on the whole span a drawn column stands for, not on where it
        // starts. The one covering the left edge of the window starts before
        // it, and dropped for that the window loses its first column entirely.
        const endsAtMs = capturedAtMs + (columnStride - 1) * block.columnIntervalMs;
        if (endsAtMs < query.fromMs || capturedAtMs > query.toMs) {
            continue;
        }
        const columns = recordedWithin(block, column, columnStride);
        if (columns.length === 0) {
            continue;
        }
        frames.push(readFrame({ block, opened, band, columns, capturedAtMs }));
    }
    return frames;
}

/**
 * The columns of one stride that hold a recording.
 *
 * A block holds a place for every instant it spans, and a recording that began
 * halfway through one leaves the earlier places empty. Nought for a touch price
 * says nobody was watching, which is not the same as a book that was empty.
 */
function recordedWithin(block: ChunkBlockRow, column: number, columnStride: number): number[] {
    const recorded: number[] = [];
    const last = Math.min(column + columnStride, block.columnCount);
    for (let within = column; within < last; within += 1) {
        if ((block.bestBidPrices[within] ?? 0) > 0) {
            recorded.push(within);
        }
    }
    return recorded;
}

/** Every square of one block, unpacked ready to be read. */
function openSquares(
    block: ChunkBlockRow,
    squares: ReadonlyMap<string, ChunkSquareRow>,
): OpenSquare[] {
    const startedAtMs = block.startedAtMs;
    const opened: OpenSquare[] = [];
    for (const [key, square] of squares) {
        if (!key.startsWith(`${startedAtMs}:`)) {
            continue;
        }
        opened.push({
            lowestBucketIndex: square.lowestBucketIndex,
            planes: { lowPlane: square.lowPlane, highPlane: square.highPlane },
            grid: {
                rowCount: ROWS_PER_CHUNK,
                columnCount: square.columnCount,
                stepRatio: block.stepRatio,
                smallestQuantity: block.smallestQuantity,
            },
        });
    }
    return opened;
}

interface FrameRead {
    readonly block: ChunkBlockRow;
    readonly opened: readonly OpenSquare[];
    readonly band: PriceBand | null;
    /** The stored columns this drawn one stands for, largest of them winning. */
    readonly columns: readonly number[];
    readonly capturedAtMs: number;
}

/**
 * The rows of one square the band reaches, or null when it reaches none.
 *
 * @param square - The square about to be read.
 * @param band - The prices the reader asked for, or null for all of them.
 * @returns Where to start reading inside the square, and how far.
 */
function bandRowsWithin(
    square: OpenSquare,
    band: PriceBand | null,
): { fromRow: number; rowCount: number } | null {
    if (band === null) {
        return { fromRow: 0, rowCount: ROWS_PER_CHUNK };
    }
    const fromRow = Math.max(0, band.lowestBucketIndex - square.lowestBucketIndex);
    const toRow = Math.min(
        ROWS_PER_CHUNK,
        band.lowestBucketIndex + band.bucketCount - square.lowestBucketIndex,
    );
    return toRow <= fromRow ? null : { fromRow, rowCount: toRow - fromRow };
}

/** One instant, gathered from every square that holds part of it. */
function readFrame(read: FrameRead): LiquidityFrame {
    const { block, opened, band, columns } = read;
    const byBucket = new Map<number, number>();

    for (const square of opened) {
        // Only the rows of the square the reader can draw. A square is five
        // hundred and twelve prices tall and a band often crosses a handful of
        // them: read whole, every price outside the band is unpacked, scaled
        // back off the ratio it was stored on, and then dropped. Measured on a
        // nine hour window, that was most of two and a half seconds.
        const rows = bandRowsWithin(square, band);
        if (rows === null) {
            continue;
        }
        for (const column of columns) {
            const sizes = readTileColumnRows(square.planes, square.grid, {
                column, fromRow: rows.fromRow, rowCount: rows.rowCount,
            });
            for (let row = 0; row < sizes.length; row += 1) {
                const quantity = sizes[row] ?? 0;
                if (quantity <= 0) {
                    continue;
                }
                const at = place(band, square.lowestBucketIndex + rows.fromRow + row);
                if (at !== null) {
                    byBucket.set(at, Math.max(byBucket.get(at) ?? 0, quantity));
                }
            }
        }
    }

    const first = columns[0]!;
    const bestBidPrice = block.bestBidPrices[first] ?? 0;
    const bestAskPrice = block.bestAskPrices[first] ?? 0;
    const storedTouch = Math.round(bestBidPrice / block.priceBucketSize);
    const touch = Math.floor(storedTouch / (band?.bucketsPerRow ?? 1));
    return {
        capturedAtMs: read.capturedAtMs,
        bestBidPrice,
        bestAskPrice,
        ...toLadders(byBucket, touch),
    };
}

/** One column of a block, back on the scale it was written on. */
function readColumnSteps(
    opened: readonly OpenSquare[],
    column: number,
    block: ChunkBlockRow,
): Map<number, number> {
    const scale: QuantityScale = {
        stepRatio: block.stepRatio,
        smallestQuantity: block.smallestQuantity,
    };
    const steps = new Map<number, number>();
    for (const square of opened) {
        const sizes = readTileColumnRows(square.planes, square.grid, {
            column, fromRow: 0, rowCount: ROWS_PER_CHUNK,
        });
        for (let row = 0; row < sizes.length; row += 1) {
            const quantity = sizes[row] ?? 0;
            if (quantity > 0) {
                steps.set(square.lowestBucketIndex + row,
                    quantiseQuantity(quantity, scale, LARGEST_STEP));
            }
        }
    }
    return steps;
}

/**
 * The first instant a run of blocks holds a recording of.
 *
 * Not where the blocks begin: a block is addressed by a fixed grid, so one
 * opens at its own start whatever hour the recording reached it, and the
 * columns before that carry a touch of nought. Six days of a level five block
 * can stand for one minute of recording.
 */
function firstRecordedMs(blocks: readonly ChunkBlockRow[]): number {
    let earliest = Number.POSITIVE_INFINITY;
    for (const block of blocks) {
        const column = block.bestBidPrices.findIndex((price) => price > 0);
        if (column >= 0) {
            earliest = Math.min(
                earliest,
                block.startedAtMs + column * block.columnIntervalMs,
            );
        }
    }
    return earliest;
}

/**
 * The highest price the touch reached across a run of blocks.
 *
 * Nought where a block holds nothing: a caller asking for rows over an empty
 * archive is answered with no band rather than with a band of nothing.
 */
function highestTouch(blocks: readonly ChunkBlockRow[]): number {
    let highest = 0;
    for (const block of blocks) {
        for (const price of block.bestBidPrices) {
            if (price > highest) {
                highest = price;
            }
        }
    }
    return highest;
}

/** Where a stored bucket is reported, or nothing when it is off screen. */
function place(band: PriceBand | null, bucketIndex: number): number | null {
    if (band === null) {
        return bucketIndex;
    }
    const row = toBandRow(band, bucketIndex);
    return row === null ? null : toFoldedBucketIndex(band, row);
}

/** The squares one stretch of instants fills, by the price block each sits in. */
function gatherSquares(columns: readonly ChunkColumn[]): Map<number, Map<number, number>[]> {
    const squares = new Map<number, Map<number, number>[]>();
    columns.forEach((column, index) => {
        for (const [bucketIndex, step] of column.steps) {
            const priceBlock = Math.floor(bucketIndex / ROWS_PER_CHUNK);
            let held = squares.get(priceBlock);
            if (held === undefined) {
                held = Array.from({ length: columns.length }, () => new Map<number, number>());
                squares.set(priceBlock, held);
            }
            held[index]!.set(bucketIndex, step);
        }
    });
    return squares;
}

export { COLUMNS_PER_CHUNK, columnsPerCell };
