import type { LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import type { ChartDataset } from '../core/chart-dataset.ts';

/**
 * Bucket rows the source image is allowed to hold.
 */
const MAXIMUM_BUCKET_ROWS = 6_000;

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
    readonly bucketCount: number;
}

export function measureExtent(dataset: ChartDataset): FieldExtent {
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
    const pixelBudgetRows = Math.floor(MAXIMUM_FIELD_PIXELS / Math.max(1, columnCapacity));
    const bucketCount = Math.max(1, Math.min(requestedRows, MAXIMUM_BUCKET_ROWS, pixelBudgetRows));

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
