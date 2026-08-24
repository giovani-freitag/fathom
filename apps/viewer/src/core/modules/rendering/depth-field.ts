import type { LiquidityFrame } from '@fathom/contracts';
import { DepthColourScale } from '@core/domain/depth-colour-scale';
import type { ChartDataset } from '@core/modules/chart/chart-dataset';
import { measureExtent } from './field-extent';

export interface DepthFieldConfig {
    readonly dataset: ChartDataset;
    readonly colourGain: number;
}

/**
 * The depth window rendered once into an offscreen image, in time and bucket space.
 *
 * Painting per screen pixel on every gesture would repaint hundreds of thousands
 * of pixels per frame. Painting once into a grid whose axes are time and price
 * bucket lets pan and zoom become a single scaled `drawImage`, which the browser
 * hands to the compositor.
 *
 * Streamed frames are painted onto the existing image rather than triggering a
 * repaint of the whole window: a live second changes one column, and rebuilding
 * the other two thousand costs tens of milliseconds twice a second for nothing.
 */
export class DepthField {
    readonly baseTimestampMs: number;
    readonly sampleIntervalMs: number;
    readonly columnCount: number;
    readonly lowestBucketIndex: number;
    readonly bucketCount: number;
    readonly priceBucketSize: number;
    readonly saturationQuantity: number;
    readonly canvas: HTMLCanvasElement;

    private readonly context: CanvasRenderingContext2D | null;
    private readonly colourScale: DepthColourScale;
    private readonly columnCapacity: number;
    private readonly instrumentSymbol: string;
    private readonly colourGain: number;

    private paintedFrameCount = 0;
    private lastPaintedFrame: LiquidityFrame | null = null;

    constructor(config: DepthFieldConfig) {
        const { dataset } = config;
        const extent = measureExtent(dataset);

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
        this.colourScale = new DepthColourScale({
            saturationQuantity: dataset.saturationQuantity,
            gain: config.colourGain,
        });

        this.canvas = document.createElement('canvas');
        this.canvas.width = Math.max(1, extent.columnCapacity);
        this.canvas.height = Math.max(1, extent.bucketCount);
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
     * Row a price maps to, with price growing upward.
     *
     * @param price - Price in quote currency.
     * @returns The row, which may fall outside the image.
     */
    priceToRow(price: number): number {
        const highestBucketIndex = this.lowestBucketIndex + this.bucketCount - 1;
        return highestBucketIndex - price / this.priceBucketSize + 1;
    }

    /**
     * Brings the image up to date with a dataset that only grew.
     *
     * @param dataset - The snapshot to catch up to.
     * @param colourGain - Gain the caller wants rendered.
     * @returns True when the image now represents the dataset; false when the
     *          window changed in a way that needs a fresh field.
     */
    absorb(dataset: ChartDataset, colourGain: number): boolean {
        if (!this.sharesGridWith(dataset, colourGain) || dataset.frames.length < this.paintedFrameCount) {
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

    private sharesGridWith(dataset: ChartDataset, colourGain: number): boolean {
        return dataset.instrumentSymbol === this.instrumentSymbol
            && dataset.priceBucketSize === this.priceBucketSize
            && dataset.sampleIntervalMs === this.sampleIntervalMs
            && dataset.saturationQuantity === this.saturationQuantity
            && colourGain === this.colourGain;
    }

    /**
     * Whether arriving frames fit the image's columns and its price band.
     *
     * A price that walked out of the band would otherwise leave the live edge
     * blank, which reads as missing data rather than as a stale field.
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
     *
     * The bookkeeping is deliberately separate from the drawing: tying them
     * together would leave a field with no drawing context permanently claiming
     * it has absorbed nothing, and every arriving second would allocate another
     * field that also cannot draw.
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
        const image = context.createImageData(width, this.bucketCount);
        for (const frame of frames) {
            this.paintFrame(image, frame, bounds.firstColumn, width);
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

    private paintFrame(
        image: ImageData,
        frame: LiquidityFrame,
        columnOffset: number,
        imageWidth: number,
    ): void {
        const column = Math.round(this.timeToColumn(frame.capturedAtMs)) - columnOffset;
        if (column < 0 || column >= imageWidth) {
            return;
        }
        this.paintLadder(image, frame.bids, column, imageWidth);
        this.paintLadder(image, frame.asks, column, imageWidth);
    }

    private paintLadder(
        image: ImageData,
        ladder: LiquidityFrame['bids'],
        column: number,
        imageWidth: number,
    ): void {
        const ramp = DepthColourScale.ramp();
        const highestRow = this.lowestBucketIndex + this.bucketCount - 1;
        const { quantities, lowestBucketIndex } = ladder;

        for (let offset = 0; offset < quantities.length; offset += 1) {
            const quantity = quantities[offset]!;
            if (quantity <= 0) {
                continue;
            }

            const row = highestRow - (lowestBucketIndex + offset);
            if (row < 0 || row >= this.bucketCount) {
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
