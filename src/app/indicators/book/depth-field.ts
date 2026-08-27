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
}

interface FramePaint {
    readonly image: ImageData;
    readonly frame: LiquidityFrame;
    readonly columnOffset: number;
    readonly imageWidth: number;
}

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

    private paintedFrameCount = 0;
    private lastPaintedFrame: LiquidityFrame | null = null;

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

        this.canvas = document.createElement('canvas');
        this.canvas.width = Math.max(1, extent.columnCapacity);
        this.canvas.height = Math.max(1, this.rowCount);
        this.context = this.canvas.getContext('2d');

        this.paintRange(dataset.frames, 0);
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
            || dataset.frames.length < this.paintedFrameCount) {
            return false;
        }

        // Identity of the last painted frame, not just the count: a refetched
        // window decodes fresh frame objects, so an unchanged count alone would
        // let the field keep showing the window it painted before the pan.
        if (dataset.frames[this.paintedFrameCount - 1] !== this.lastPaintedFrame) {
            return false;
        }
        if (dataset.frames.length === this.paintedFrameCount) {
            return true;
        }

        const arrivals = dataset.frames.slice(this.paintedFrameCount);
        if (!this.canHold(arrivals)) {
            return false;
        }

        this.paintRange(arrivals, this.paintedFrameCount);
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

    /**
     * Records a run of frames as painted, whether or not pixels could be written.
     */
    private paintRange(frames: readonly LiquidityFrame[], alreadyPaintedCount: number): void {
        const lastFrame = frames[frames.length - 1];
        if (lastFrame === undefined) {
            return;
        }

        this.paintPixels(frames);
        this.paintedFrameCount = alreadyPaintedCount + frames.length;
        this.lastPaintedFrame = lastFrame;
    }

    private paintPixels(frames: readonly LiquidityFrame[]): void {
        const context = this.context;
        const bounds = this.measureColumnBounds(frames);
        if (context === null || bounds === null || this.bucketCount === 0) {
            return;
        }

        const width = bounds.lastColumn - bounds.firstColumn + 1;
        const image = context.createImageData(width, this.rowCount);
        for (const frame of frames) {
            this.paintFrame({ image, frame, columnOffset: bounds.firstColumn, imageWidth: width });
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

    private paintFrame(request: FramePaint): void {
        const { image, frame, columnOffset, imageWidth } = request;
        const column = Math.round(this.timeToColumn(frame.capturedAtMs)) - columnOffset;
        if (column < 0 || column >= imageWidth) {
            return;
        }

        const touched = this.folder.fold(frame);
        if (touched === null) {
            return;
        }

        this.paintRows({ image, column, imageWidth }, touched);
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

/** Where one column of the image is being written. */
interface RowTarget {
    readonly image: ImageData;
    readonly column: number;
    readonly imageWidth: number;
}
