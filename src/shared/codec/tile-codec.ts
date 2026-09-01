/**
 * The scale a size is placed on: where it starts and how fast it grows.
 *
 * Separate from the shape of the picture holding it, because a size is placed
 * on this scale whether or not there is a picture yet. The store that keeps the
 * book as squares quantises a whole instant before it knows which squares it
 * falls into, and had to invent a one-cell picture to say so.
 */
export interface QuantityScale {
    /** How much larger each step is than the one below it. 1.02 is two percent. */
    readonly stepRatio: number;
    /** The size the first step stands for. */
    readonly smallestQuantity: number;
}

/**
 * The largest step a cell can hold, which is two bytes of it.
 *
 * The ceiling of the scale, so a writer and a reader cannot each pick their own
 * and disagree about what a saturated cell means.
 */
export const LARGEST_STEP = 65_535;

/**
 * One tile's grid: what a cell means and how many there are.
 *
 * Carried with the picture rather than assumed, so a reader who tightens the
 * precision cannot silently reinterpret what was written under the old one.
 */
export interface TileGrid extends QuantityScale {
    readonly rowCount: number;
    readonly columnCount: number;
    /**
     * How the cells sit in the plane. Defaults to `byRow`, the cheaper one.
     *
     * Part of the grid rather than a separate argument because it describes the
     * picture the same way its width does: a plane read under the wrong layout
     * is silently wrong rather than empty, so the two must never be able to
     * drift apart.
     */
    readonly layout?: PlaneLayout;
}

/**
 * How the cells of a plane are laid out in it.
 *
 * `byColumn` walks a whole instant before moving on; `byRow` walks one price
 * through the whole tile before moving on. They hold the same cells and the
 * choice is free, but a price changes far less across a tile than an instant
 * changes across the book, so laying it out by row puts the repetition next to
 * itself where a compressor can find it. Measured on a recorded book, that is
 * about a fifth off before the compressor is even chosen.
 */
export type PlaneLayout = 'byColumn' | 'byRow';

/** The picture, one byte plane per byte of a cell. */
export interface TilePlanes {
    readonly lowPlane: Uint8Array;
    /** Absent where the precision fits in one byte per cell. */
    readonly highPlane: Uint8Array | null;
}

const ONE_BYTE_LIMIT = 255;
const TWO_BYTE_LIMIT = LARGEST_STEP;

/**
 * How many steps a precision needs to span a range of sizes.
 *
 * @param grid - The scale's ratio and floor.
 * @param largestQuantity - The biggest size the scale has to reach.
 * @returns The step the largest size lands on.
 */
export function countSteps(grid: TileGrid, largestQuantity: number): number {
    if (largestQuantity <= grid.smallestQuantity) {
        return 1;
    }
    return Math.ceil(
        Math.log(largestQuantity / grid.smallestQuantity) / Math.log(grid.stepRatio),
    );
}

/**
 * A resting size as a step on the tile's scale.
 *
 * Nought is reserved for a price nothing is resting at, so the smallest size
 * that exists still reads as one step rather than as empty.
 *
 * @param quantity - The size to place.
 * @param scale - The scale to place it on.
 * @param maximumStep - The largest step the cell can hold.
 * @returns A step from 0 to `maximumStep`.
 */
export function quantiseQuantity(
    quantity: number,
    scale: QuantityScale,
    maximumStep: number,
): number {
    if (!(quantity > 0)) {
        return 0;
    }
    const step = Math.round(
        Math.log(quantity / scale.smallestQuantity) / Math.log(scale.stepRatio),
    );
    return Math.max(1, Math.min(maximumStep, step));
}

/**
 * The size a step stands for.
 *
 * @param step - The step read out of a cell.
 * @param scale - The scale it was written on.
 * @returns The size, or nought where the cell was empty.
 */
export function readQuantisedQuantity(step: number, scale: QuantityScale): number {
    if (step <= 0) {
        return 0;
    }
    return scale.smallestQuantity * scale.stepRatio ** step;
}

/**
 * Lays a run of columns out as byte planes.
 *
 * The two bytes of a cell go into separate planes rather than side by side. The
 * high byte barely changes between neighbours and all but vanishes on its own,
 * where interleaving pays the second byte in full.
 *
 * A whole byte per half-cell rather than the ten bits a step actually needs,
 * which looks wasteful and is not. Measured over a recorded book, packing to
 * the true bit width came out sixteen percent LARGER and a plane per bit twenty
 * one percent larger: the compressor that follows finds its repeats on byte
 * boundaries, and shifting every value out of alignment hides them. What the
 * cell costs is not what the plane costs.
 *
 * @param columns - One array of sizes per column, bottom row first.
 * @param grid - The scale and the shape to write them on.
 * @returns The planes, the high one absent when one byte per cell is enough.
 */
export function packTile(columns: readonly (readonly number[])[], grid: TileGrid): TilePlanes {
    let largest = 0;
    for (const column of columns) {
        for (const quantity of column) {
            if (quantity > largest) {
                largest = quantity;
            }
        }
    }

    const needsTwoBytes = countSteps(grid, largest) > ONE_BYTE_LIMIT;
    const maximumStep = needsTwoBytes ? TWO_BYTE_LIMIT : ONE_BYTE_LIMIT;
    const cells = grid.rowCount * grid.columnCount;
    const lowPlane = new Uint8Array(cells);
    const highPlane = needsTwoBytes ? new Uint8Array(cells) : null;

    for (let column = 0; column < grid.columnCount; column += 1) {
        const sizes = columns[column] ?? [];
        for (let row = 0; row < grid.rowCount; row += 1) {
            const step = quantiseQuantity(sizes[row] ?? 0, grid, maximumStep);
            const cell = placeCell(grid, column, row);
            lowPlane[cell] = step & 0xff;
            if (highPlane !== null) {
                highPlane[cell] = step >> 8;
            }
        }
    }

    return { lowPlane, highPlane };
}

/**
 * Where one cell of the picture sits in its plane.
 */
function placeCell(grid: TileGrid, column: number, row: number): number {
    return (grid.layout ?? 'byRow') === 'byRow'
        ? row * grid.columnCount + column
        : column * grid.rowCount + row;
}

/** One column of a picture, and the stretch of its rows a reader wants. */
export interface TileColumnRead {
    readonly column: number;
    readonly fromRow: number;
    readonly rowCount: number;
}

/**
 * Part of one column, as sizes on the tile's scale.
 *
 * A reader looking at a hundred prices out of four hundred pays for the other
 * three hundred on every column of the window, and a wide window is tens of
 * thousands of columns. What it hands back is only the stretch asked for, so
 * the rows above and below are never touched.
 *
 * A stretch reaching past either end of the picture is trimmed to what is
 * there, so the first size handed back is the first row that exists rather than
 * the first row asked for. Callers holding an offset of their own must clamp it
 * the same way, or read every price off its neighbour.
 *
 * @param planes - The stored bytes.
 * @param grid - The shape and scale they were written on.
 * @param read - The column, and where its wanted rows start and end.
 * @returns The sizes of that stretch, lowest row first.
 */
export function readTileColumnRows(
    planes: TilePlanes,
    grid: TileGrid,
    read: TileColumnRead,
): Float32Array {
    const fromRow = Math.max(0, read.fromRow);
    const toRow = Math.min(grid.rowCount, read.fromRow + read.rowCount);
    const sizes = new Float32Array(Math.max(0, toRow - fromRow));
    if (read.column < 0 || read.column >= grid.columnCount) {
        return sizes;
    }

    for (let row = fromRow; row < toRow; row += 1) {
        const cell = placeCell(grid, read.column, row);
        const step = (planes.lowPlane[cell] ?? 0) + ((planes.highPlane?.[cell] ?? 0) << 8);
        sizes[row - fromRow] = readQuantisedQuantity(step, grid);
    }
    return sizes;
}
