import type { LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import type { ChartDataset } from '../core/chart-dataset.ts';

/**
 * Rows the source image is allowed to hold.
 *
 * Counted in drawn rows rather than in price buckets: a wide window folds many
 * buckets into one row, and it is the rows that cost memory.
 */
const MAXIMUM_IMAGE_ROWS = 6_000;

/**
 * Total pixels the field may allocate, at four bytes each.
 */
const MAXIMUM_FIELD_PIXELS = 8_000_000;

/**
 * Spare columns kept to the right of the loaded window.
 */
const APPEND_HEADROOM_MS = 600_000;

export interface FieldExtent {
    readonly baseTimestampMs: number;
    readonly columnCount: number;
    readonly columnCapacity: number;
    readonly lowestBucketIndex: number;
    /** Price buckets the field covers, always a whole number of bands. */
    readonly bucketCount: number;
}

/**
 * The grid a field should be built on.
 *
 * @param dataset - The window to cover.
 * @param bucketsPerBand - Price buckets folded into one drawn row.
 * @returns Where the field starts, how far it reaches, and how much it holds.
 */
export function measureExtent(dataset: ChartDataset, bucketsPerBand = 1): FieldExtent {
    const firstFrame = dataset.frames[0];
    const lastFrame = dataset.frames[dataset.frames.length - 1];
    if (firstFrame === undefined || lastFrame === undefined) {
        return {
            baseTimestampMs: 0,
            columnCount: 0,
            columnCapacity: 1,
            lowestBucketIndex: 0,
            bucketCount: 0,
        };
    }

    const sampleIntervalMs = Math.max(1, dataset.sampleIntervalMs);
    const columnCount = Math.max(
        1,
        Math.floor((lastFrame.capturedAtMs - firstFrame.capturedAtMs) / sampleIntervalMs) + 1,
    );
    const columnCapacity = columnCount + Math.ceil(APPEND_HEADROOM_MS / sampleIntervalMs);

    // Both ends off whichever sides actually hold prices, and never off an
    // empty one. A window read over a band the price is not in has every
    // instant on one side of the touch — a reader looking below the market
    // reads a book that is all bids — and a side with nothing in it reports
    // starting at bucket nought and reaching to one before it. Taken as the top
    // of the book, that leaves the field one row tall, addressed at a price
    // nobody is looking at, and the whole layer draws as black.
    let lowestBucketIndex = Number.POSITIVE_INFINITY;
    let highestBucketIndex = Number.NEGATIVE_INFINITY;
    for (const frame of dataset.frames) {
        for (const ladder of [frame.bids, frame.asks]) {
            if (ladder.quantities.length === 0) {
                continue;
            }
            lowestBucketIndex = Math.min(lowestBucketIndex, ladder.lowestBucketIndex);
            highestBucketIndex = Math.max(
                highestBucketIndex,
                ladder.lowestBucketIndex + ladder.quantities.length - 1,
            );
        }
    }
    if (!Number.isFinite(lowestBucketIndex)) {
        return { baseTimestampMs: firstFrame.capturedAtMs, columnCount, columnCapacity, lowestBucketIndex: 0, bucketCount: 0 };
    }

    const bandSize = Math.max(1, Math.floor(bucketsPerBand));
    const requestedRows = Math.ceil(Math.max(1, highestBucketIndex - lowestBucketIndex + 1) / bandSize);
    const pixelBudgetRows = Math.floor(MAXIMUM_FIELD_PIXELS / Math.max(1, columnCapacity));
    const rowCount = Math.max(1, Math.min(requestedRows, MAXIMUM_IMAGE_ROWS, pixelBudgetRows));
    // Whole bands only: half a band at the edge would draw a row from prices
    // the field never covered.
    const bucketCount = rowCount * bandSize;

    return {
        baseTimestampMs: firstFrame.capturedAtMs,
        columnCount,
        columnCapacity,
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
