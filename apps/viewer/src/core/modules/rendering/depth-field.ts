import type { LiquidityFrame } from '@fathom/contracts';
import { DepthColourScale } from '@core/domain/depth-colour-scale';
import type { ChartDataset } from '@core/modules/chart/chart-dataset';

/**
 * Bucket rows the source image is allowed to hold.
 *
 * A wide window over a large price move spans thousands of buckets, and the
 * field is reallocated whenever the data changes.
 */
const MAXIMUM_BUCKET_ROWS = 6_000;

/**
 * Total pixels the field may allocate, at four bytes each.
 *
 * The row cap alone is not enough: rows and columns both grow with the window,
 * and their product is what a phone has to hold. Eight million pixels is
 * thirty-two megabytes, which a wide desktop window can reach and a phone,
 * having far fewer columns, never does.
 */
const MAXIMUM_FIELD_PIXELS = 8_000_000;

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

    constructor(config: DepthFieldConfig) {
        const { dataset } = config;
        const extent = measureExtent(dataset);

        this.priceBucketSize = dataset.priceBucketSize;
        this.sampleIntervalMs = dataset.sampleIntervalMs;
        this.baseTimestampMs = extent.baseTimestampMs;
        this.columnCount = extent.columnCount;
        this.lowestBucketIndex = extent.lowestBucketIndex;
        this.bucketCount = extent.bucketCount;
        this.saturationQuantity = dataset.saturationQuantity;
        this.canvas = this.paint(dataset, config.colourGain);
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

    private paint(dataset: ChartDataset, colourGain: number): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, this.columnCount);
        canvas.height = Math.max(1, this.bucketCount);

        const context = canvas.getContext('2d');
        if (context === null || this.columnCount === 0 || this.bucketCount === 0) {
            return canvas;
        }

        const image = context.createImageData(canvas.width, canvas.height);
        const scale = new DepthColourScale({
            saturationQuantity: this.saturationQuantity,
            gain: colourGain,
        });

        for (const frame of dataset.frames) {
            this.paintFrame(image, frame, scale);
        }

        context.putImageData(image, 0, 0);
        return canvas;
    }

    private paintFrame(image: ImageData, frame: LiquidityFrame, scale: DepthColourScale): void {
        const column = Math.round(this.timeToColumn(frame.capturedAtMs));
        if (column < 0 || column >= this.columnCount) {
            return;
        }
        this.paintLadder(image, frame.bids.lowestBucketIndex, frame.bids.quantities, column, scale);
        this.paintLadder(image, frame.asks.lowestBucketIndex, frame.asks.quantities, column, scale);
    }

    private paintLadder(
        image: ImageData,
        lowestBucketIndex: number,
        quantities: Float32Array,
        column: number,
        scale: DepthColourScale,
    ): void {
        const ramp = DepthColourScale.ramp();
        const highestRow = this.lowestBucketIndex + this.bucketCount - 1;

        for (let offset = 0; offset < quantities.length; offset += 1) {
            const quantity = quantities[offset]!;
            if (quantity <= 0) {
                continue;
            }

            const row = highestRow - (lowestBucketIndex + offset);
            if (row < 0 || row >= this.bucketCount) {
                continue;
            }

            const rampOffset = scale.toRampIndex(quantity) * 4;
            const pixelOffset = (row * this.columnCount + column) * 4;
            image.data[pixelOffset] = ramp[rampOffset]!;
            image.data[pixelOffset + 1] = ramp[rampOffset + 1]!;
            image.data[pixelOffset + 2] = ramp[rampOffset + 2]!;
            image.data[pixelOffset + 3] = ramp[rampOffset + 3]!;
        }
    }
}

interface FieldExtent {
    readonly baseTimestampMs: number;
    readonly columnCount: number;
    readonly lowestBucketIndex: number;
    readonly bucketCount: number;
}

function measureExtent(dataset: ChartDataset): FieldExtent {
    const firstFrame = dataset.frames[0];
    const lastFrame = dataset.frames[dataset.frames.length - 1];
    if (firstFrame === undefined || lastFrame === undefined) {
        return { baseTimestampMs: 0, columnCount: 0, lowestBucketIndex: 0, bucketCount: 0 };
    }

    const sampleIntervalMs = Math.max(1, dataset.sampleIntervalMs);
    const columnCount = Math.floor((lastFrame.capturedAtMs - firstFrame.capturedAtMs) / sampleIntervalMs) + 1;

    let lowestBucketIndex = Number.POSITIVE_INFINITY;
    let highestBucketIndex = Number.NEGATIVE_INFINITY;
    for (const frame of dataset.frames) {
        lowestBucketIndex = Math.min(lowestBucketIndex, frame.bids.lowestBucketIndex);
        highestBucketIndex = Math.max(
            highestBucketIndex,
            frame.asks.lowestBucketIndex + frame.asks.quantities.length - 1,
        );
    }

    const requestedRows = Math.max(1, highestBucketIndex - lowestBucketIndex + 1);
    const pixelBudgetRows = Math.floor(MAXIMUM_FIELD_PIXELS / Math.max(1, columnCount));
    const bucketCount = Math.max(1, Math.min(requestedRows, MAXIMUM_BUCKET_ROWS, pixelBudgetRows));

    return {
        baseTimestampMs: firstFrame.capturedAtMs,
        columnCount: Math.max(1, columnCount),
        lowestBucketIndex: chooseRetainedBand({
            frames: dataset.frames,
            priceBucketSize: dataset.priceBucketSize,
            lowestBucketIndex,
            highestBucketIndex,
            bucketCount,
        }),
        bucketCount,
    };
}

interface RetainedBandRequest {
    readonly frames: readonly LiquidityFrame[];
    readonly priceBucketSize: number;
    readonly lowestBucketIndex: number;
    readonly highestBucketIndex: number;
    readonly bucketCount: number;
}

/**
 * Lowest bucket of the band the field keeps when it cannot hold the whole range.
 *
 * Centred on the median touch rather than anchored to either extreme: a window
 * whose price trended spends most of its time nowhere near the top or the
 * bottom, and clipping from one end throws away exactly the part that was busy.
 *
 * @param request - The frames, the grid, and the band size to fit.
 * @returns The lowest bucket index the field should start at.
 */
function chooseRetainedBand(request: RetainedBandRequest): number {
    const fullRange = request.highestBucketIndex - request.lowestBucketIndex + 1;
    if (request.bucketCount >= fullRange) {
        return request.lowestBucketIndex;
    }

    const midBuckets = request.frames
        .map((frame) => Math.floor(
            (frame.bestBidPrice + frame.bestAskPrice) / 2 / request.priceBucketSize,
        ))
        .sort((left, right) => left - right);
    const medianBucket = midBuckets[Math.floor(midBuckets.length / 2)] ?? request.lowestBucketIndex;

    const desiredLowest = medianBucket - Math.floor(request.bucketCount / 2);
    const highestAllowedStart = request.highestBucketIndex - request.bucketCount + 1;
    return Math.min(Math.max(desiredLowest, request.lowestBucketIndex), highestAllowedStart);
}
