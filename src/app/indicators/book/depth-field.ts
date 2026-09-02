import type { LiquidityFrame } from '../../../shared/core/liquidity-frame.ts';
import { DepthColourScale } from './depth-colour-scale.ts';
import { DepthRowFolder, type TouchedRows } from './depth-row-folder.ts';
import type { ChartDataset } from '../../core/chart-dataset.ts';
import { measureExtent } from '../../painting/field-extent.ts';

export interface DepthFieldConfig {
    readonly dataset: ChartDataset;
    readonly colourGain: number;
    /**
     * Price buckets folded into one drawn row.
     *
     * One at close range, where every bucket has a pixel of its own. More as the
     * window widens, because a row thinner than a pixel is not something the
     * browser can draw: the walls a reader is looking for come out as scattered
     * specks, and half of them are dropped entirely.
     */
    readonly bucketsPerBand: number;
    /**
     * A surface to build on rather than a fresh one.
     *
     * A field the size of a loaded window is several megabytes of pixels, and
     * asking the browser for them is one expensive frame every time the grid
     * changes — which is every time the reader zooms. Handed the one being
     * replaced, the field draws over it instead: setting the size clears it,
     * so nothing of the old picture survives into the new one.
     */
    readonly reuse?: HTMLCanvasElement | undefined;
}

/**
 * Instants painted before the clock is asked again.
 *
 * Asking on every one costs more than painting one does; a few dozen is fine
 * grained enough that a slice overruns its share by microseconds.
 */
const FRAMES_PER_SLICE = 48;

/**
 * The depth window rendered once into an offscreen image, in time and bucket space.
 */
export class DepthField {
    readonly baseTimestampMs: number;
    readonly sampleIntervalMs: number;
    readonly columnCount: number;
    readonly lowestBucketIndex: number;
    readonly bucketCount: number;
    readonly priceBucketSize: number;
    readonly bucketsPerBand: number;
    /** Rows the image holds, one per band of buckets. */
    readonly rowCount: number;
    readonly saturationQuantity: number;
    readonly floorQuantity: number;
    readonly canvas: HTMLCanvasElement;

    private readonly context: CanvasRenderingContext2D | null;
    private readonly colourScale: DepthColourScale;
    private readonly columnCapacity: number;
    private readonly instrumentSymbol: string;
    private readonly colourGain: number;

    /** Folds a frame's buckets into the rows they are drawn as. */
    private readonly folder: DepthRowFolder;

    /**
     * Every instant the field stands for, painted or still waiting.
     *
     * Held rather than painted at once. A window of a few hours is some
     * thousands of instants by some hundreds of rows, and folding and colouring
     * all of them is a third of a second in one go — measured on a four hour
     * window, eight hundred and sixty milliseconds of the main thread across
     * three rebuilds, with the candles and the axes frozen behind it because
     * they share that thread. Painted a slice at a time it costs the same
     * altogether and blocks nothing.
     */
    private frames: readonly LiquidityFrame[];
    /**
     * How many of them the field has taken on.
     *
     * Counted rather than read off the array: what a dataset hands over is only
     * a reference, and one that grows afterwards would have the field painting
     * instants it never checked it had room for.
     */
    private adoptedFrameCount: number;
    /**
     * The run already painted, as the half-open range of instants it covers.
     *
     * Grown outward from where the reader is looking rather than forward from
     * the oldest instant. The window loaded reaches well past the view on both
     * sides so that a short pan needs no round trip, which means painting it in
     * order spends the first half of the work on instants nobody is looking at
     * — and the reader watches the old picture for all of it.
     */
    private paintedFrom = 0;
    private paintedTo = 0;

    constructor(config: DepthFieldConfig) {
        const { dataset } = config;
        const bucketsPerBand = Math.max(1, Math.floor(config.bucketsPerBand));
        const extent = measureExtent(dataset, bucketsPerBand);

        this.bucketsPerBand = bucketsPerBand;
        this.rowCount = extent.bucketCount / bucketsPerBand;
        this.folder = new DepthRowFolder({
            rowCount: this.rowCount,
            highestBucketIndex: extent.lowestBucketIndex + extent.bucketCount - 1,
            bucketsPerBand,
        });
        this.instrumentSymbol = dataset.instrumentSymbol;
        this.colourGain = config.colourGain;
        this.priceBucketSize = dataset.priceBucketSize;
        this.sampleIntervalMs = dataset.sampleIntervalMs;
        this.baseTimestampMs = extent.baseTimestampMs;
        this.columnCount = extent.columnCount;
        this.columnCapacity = extent.columnCapacity;
        this.lowestBucketIndex = extent.lowestBucketIndex;
        this.bucketCount = extent.bucketCount;
        this.saturationQuantity = dataset.saturationQuantity;
        this.floorQuantity = dataset.floorQuantity;
        this.colourScale = new DepthColourScale({
            saturationQuantity: dataset.saturationQuantity,
            floorQuantity: dataset.floorQuantity,
            gain: config.colourGain,
        });

        this.canvas = config.reuse ?? document.createElement('canvas');
        // Assigned whether or not they differ: setting either is what clears
        // the surface, and a reused one still holds the picture it was built
        // for.
        this.canvas.width = Math.max(1, extent.columnCapacity);
        this.canvas.height = Math.max(1, this.rowCount);
        this.context = this.canvas.getContext('2d');

        this.frames = dataset.frames;
        this.adoptedFrameCount = dataset.frames.length;
    }

    /**
     * Paints as much of what is left as fits in one frame's share of the thread.
     *
     * @param budgetMs - How long this pass may hold the thread.
     * @returns True when nothing is left to paint.
     */
    settle(budgetMs: number, focusFromMs?: number): boolean {
        this.focusOn(focusFromMs);
        const startedAt = performance.now();
        while (!this.isPainted) {
            this.paintOneSlice();
            if (performance.now() - startedAt >= budgetMs) {
                return this.isPainted;
            }
        }
        return true;
    }

    /** Whether every instant the field has taken on has been painted. */
    private get isPainted(): boolean {
        return this.paintedFrom === 0 && this.paintedTo >= this.adoptedFrameCount;
    }

    /**
     * Anchors the painting where the reader is looking, once.
     *
     * Once, because moving it afterwards would leave the run already painted
     * with a hole in the middle of it, and the field draws one run.
     */
    private focusOn(focusFromMs: number | undefined): void {
        if (this.paintedTo > 0 || this.paintedFrom > 0 || focusFromMs === undefined) {
            return;
        }
        const first = this.frames[0];
        if (first === undefined) {
            return;
        }
        const at = Math.round((focusFromMs - first.capturedAtMs) / this.sampleIntervalMs);
        this.paintedFrom = Math.min(Math.max(0, at), this.adoptedFrameCount);
        this.paintedTo = this.paintedFrom;
    }

    /** Paints the next run, ahead of where the reader is looking before behind. */
    private paintOneSlice(): void {
        if (this.paintedTo < this.adoptedFrameCount) {
            const upTo = this.sliceEnd(this.paintedTo);
            this.paintPixels(this.frames.slice(this.paintedTo, upTo));
            this.paintedTo = upTo;
            return;
        }
        const from = this.sliceStart(this.paintedFrom);
        this.paintPixels(this.frames.slice(from, this.paintedFrom));
        this.paintedFrom = from;
    }

    /**
     * Where the next slice ends, which is never inside a drawn column.
     *
     * A slice is written to the image whole, replacing the columns it covers, so
     * two slices sharing a column would leave only what the later one put there.
     * Ending on a column boundary keeps the rows the earlier instants painted.
     */
    private sliceEnd(from: number): number {
        const wanted = Math.min(from + FRAMES_PER_SLICE, this.adoptedFrameCount);
        let end = wanted;
        while (end < this.adoptedFrameCount
            && this.columnOf(this.frames[end]!) === this.columnOf(this.frames[end - 1]!)) {
            end += 1;
        }
        return end;
    }

    /** Where the slice behind one ends, on a column boundary as well. */
    private sliceStart(to: number): number {
        let start = Math.max(0, to - FRAMES_PER_SLICE);
        while (start > 0
            && this.columnOf(this.frames[start]!) === this.columnOf(this.frames[start - 1]!)) {
            start -= 1;
        }
        return start;
    }

    /** The drawn column an instant lands in. */
    private columnOf(frame: LiquidityFrame): number {
        return Math.round(this.timeToColumn(frame.capturedAtMs));
    }

    /** Which of the instants it holds have been painted, as a half-open range. */
    get paintedRange(): { readonly from: number; readonly to: number } {
        return { from: this.paintedFrom, to: this.paintedTo };
    }

    /**
     * Column an instant maps to.
     *
     * @param timestampMs - Unix milliseconds.
     * @returns The column, which may fall outside the image.
     */
    timeToColumn(timestampMs: number): number {
        return (timestampMs - this.baseTimestampMs) / this.sampleIntervalMs;
    }

    /**
     * How much price one drawn row covers.
     */
    get priceRowSize(): number {
        return this.priceBucketSize * this.bucketsPerBand;
    }

    /**
     * Row a price maps to, with price growing upward.
     *
     * @param price - Price in quote currency.
     * @returns The row, which may fall outside the image.
     */
    priceToRow(price: number): number {
        const highestBucketIndex = this.lowestBucketIndex + this.bucketCount - 1;
        return (highestBucketIndex - price / this.priceBucketSize + 1) / this.bucketsPerBand;
    }

    /**
     * Brings the image up to date with a dataset that only grew.
     *
     * @param dataset - The snapshot to catch up to.
     * @param colourGain - Gain the caller wants rendered.
     * @returns True when the image now represents the dataset; false when the
     *          window changed in a way that needs a fresh field.
     */
    absorb(dataset: ChartDataset, colourGain: number, bucketsPerBand: number): boolean {
        if (!this.sharesGridWith(dataset, colourGain, bucketsPerBand)
            || dataset.frames.length < this.adoptedFrameCount) {
            return false;
        }

        // Identity of the last instant it holds, not just the count: a
        // refetched window decodes fresh frame objects, so an unchanged count
        // alone would let the field keep showing the window it held before the
        // pan.
        const adopted = this.adoptedFrameCount;
        if (dataset.frames[adopted - 1] !== this.frames[adopted - 1]) {
            return false;
        }
        if (dataset.frames.length === adopted) {
            return true;
        }

        // Adopted rather than painted. What is new joins what has not been
        // painted yet, and the next slice takes them in order.
        const arrivals = dataset.frames.slice(adopted);
        if (!this.canHold(arrivals)) {
            return false;
        }

        this.frames = dataset.frames;
        this.adoptedFrameCount = dataset.frames.length;
        return true;
    }

    private sharesGridWith(
        dataset: ChartDataset,
        colourGain: number,
        bucketsPerBand: number,
    ): boolean {
        return Math.max(1, Math.floor(bucketsPerBand)) === this.bucketsPerBand
            && dataset.instrumentSymbol === this.instrumentSymbol
            && dataset.priceBucketSize === this.priceBucketSize
            && dataset.sampleIntervalMs === this.sampleIntervalMs
            && dataset.saturationQuantity === this.saturationQuantity
            && dataset.floorQuantity === this.floorQuantity
            && colourGain === this.colourGain;
    }

    /**
     * Whether arriving frames fit the image's columns and its price band.
     */
    private canHold(arrivals: readonly LiquidityFrame[]): boolean {
        const highestBucketIndex = this.lowestBucketIndex + this.bucketCount - 1;

        for (const frame of arrivals) {
            if (Math.round(this.timeToColumn(frame.capturedAtMs)) >= this.columnCapacity) {
                return false;
            }
            const touchBucket = Math.floor(
                (frame.bestBidPrice + frame.bestAskPrice) / 2 / this.priceBucketSize,
            );
            if (touchBucket < this.lowestBucketIndex || touchBucket > highestBucketIndex) {
                return false;
            }
        }
        return true;
    }

    private paintPixels(frames: readonly LiquidityFrame[]): void {
        const context = this.context;
        const bounds = this.measureColumnBounds(frames);
        if (context === null || bounds === null || this.bucketCount === 0) {
            return;
        }

        const width = bounds.lastColumn - bounds.firstColumn + 1;
        const image = context.createImageData(width, this.rowCount);
        // Instants sharing a drawn column are folded together, not painted over
        // one another. A window wider than the recording is fine puts several
        // seconds in every column: painted one after another, the column keeps
        // whichever second went last, wherever that second happened to rest.
        // The store folds the same stretch by the largest, so the live edge
        // drew as a scatter beside history that was solid.
        let openColumn: number | null = null;
        let touched: TouchedRows | null = null;
        for (const frame of frames) {
            const column = Math.round(this.timeToColumn(frame.capturedAtMs)) - bounds.firstColumn;
            if (column < 0 || column >= width) {
                continue;
            }
            if (openColumn !== null && column !== openColumn) {
                this.flushColumn({ image, column: openColumn, imageWidth: width }, touched);
                touched = null;
            }
            openColumn = column;
            touched = widenTo(touched, this.folder.fold(frame));
        }
        if (openColumn !== null) {
            this.flushColumn({ image, column: openColumn, imageWidth: width }, touched);
        }
        context.putImageData(image, bounds.firstColumn, 0);
    }

    private measureColumnBounds(
        frames: readonly LiquidityFrame[],
    ): { firstColumn: number; lastColumn: number } | null {
        let firstColumn = Number.POSITIVE_INFINITY;
        let lastColumn = Number.NEGATIVE_INFINITY;

        for (const frame of frames) {
            const column = Math.round(this.timeToColumn(frame.capturedAtMs));
            if (column < 0 || column >= this.columnCapacity) {
                continue;
            }
            firstColumn = Math.min(firstColumn, column);
            lastColumn = Math.max(lastColumn, column);
        }

        return Number.isFinite(firstColumn) ? { firstColumn, lastColumn } : null;
    }

    /** Writes one column out of everything folded into it, and empties it. */
    private flushColumn(target: RowTarget, touched: TouchedRows | null): void {
        if (touched === null) {
            return;
        }
        this.paintRows(target, touched);
        this.folder.clear(touched);
    }

    /**
     * Writes the folded rows of one column into the image.
     */
    private paintRows(target: RowTarget, touched: TouchedRows): void {
        const ramp = DepthColourScale.ramp();
        const { image, column, imageWidth } = target;

        for (let row = touched.lowRow; row <= touched.highRow; row += 1) {
            const quantity = this.folder.quantityAt(row);
            if (quantity <= 0) {
                continue;
            }

            const rampOffset = this.colourScale.toRampIndex(quantity) * 4;
            const pixelOffset = (row * imageWidth + column) * 4;
            image.data[pixelOffset] = ramp[rampOffset]!;
            image.data[pixelOffset + 1] = ramp[rampOffset + 1]!;
            image.data[pixelOffset + 2] = ramp[rampOffset + 2]!;
            image.data[pixelOffset + 3] = ramp[rampOffset + 3]!;
        }
    }
}

/** The rows two folds reached between them, or whichever of them reached any. */
function widenTo(held: TouchedRows | null, added: TouchedRows | null): TouchedRows | null {
    if (held === null) {
        return added;
    }
    if (added === null) {
        return held;
    }
    return {
        lowRow: Math.min(held.lowRow, added.lowRow),
        highRow: Math.max(held.highRow, added.highRow),
    };
}

/** Where one column of the image is being written. */
interface RowTarget {
    readonly image: ImageData;
    readonly column: number;
    readonly imageWidth: number;
}
