import type { LiquidityFrame } from '@fathom/contracts';
import type { ChartDataset } from '@core/modules/chart/chart-dataset';
import { EMPTY_DATASET } from '@core/modules/chart/chart-dataset';
import { measureExtent } from '@core/modules/rendering/field-extent';
import { describe, expect, it } from 'vitest';

const PRICE_BUCKET_SIZE = 10;

function buildFrame(capturedAtMs: number, midPrice: number, ladderBuckets = 20): LiquidityFrame {
    const touchBucket = Math.floor(midPrice / PRICE_BUCKET_SIZE);
    return {
        capturedAtMs,
        bestBidPrice: midPrice - 0.5,
        bestAskPrice: midPrice + 0.5,
        bids: {
            lowestBucketIndex: touchBucket - ladderBuckets,
            quantities: new Float32Array(ladderBuckets).fill(1),
        },
        asks: {
            lowestBucketIndex: touchBucket,
            quantities: new Float32Array(ladderBuckets).fill(1),
        },
    };
}

function buildDataset(frames: LiquidityFrame[], sampleIntervalMs = 1_000): ChartDataset {
    return { ...EMPTY_DATASET, priceBucketSize: PRICE_BUCKET_SIZE, sampleIntervalMs, frames };
}

describe('measureExtent', () => {
    it('collapses to nothing for an empty window', () => {
        expect(measureExtent(EMPTY_DATASET).columnCount).toBe(0);
    });

    it('spans one column per sample interval', () => {
        const frames = [0, 1_000, 2_000, 3_000].map((at) => buildFrame(at, 79_000));

        expect(measureExtent(buildDataset(frames)).columnCount).toBe(4);
    });

    it('counts columns on the sampled grid, not the frame count', () => {
        const frames = [0, 1_000, 2_000, 3_000].map((at) => buildFrame(at, 79_000));

        expect(measureExtent(buildDataset(frames, 2_000)).columnCount).toBe(2);
    });

    it('reserves headroom to the right for streamed frames', () => {
        const frames = [0, 1_000].map((at) => buildFrame(at, 79_000));

        const extent = measureExtent(buildDataset(frames));

        expect(extent.columnCapacity).toBeGreaterThan(extent.columnCount);
    });

    it('covers every ladder when the range fits', () => {
        const frames = [buildFrame(0, 79_000), buildFrame(1_000, 79_100)];

        const extent = measureExtent(buildDataset(frames));
        const highestBucket = extent.lowestBucketIndex + extent.bucketCount - 1;

        expect([extent.lowestBucketIndex <= 7_880, highestBucket >= 7_929]).toEqual([true, true]);
    });

    it('bounds the image whatever the price travelled', () => {
        const frames = Array.from({ length: 300 }, (_unused, index) => buildFrame(
            index * 1_000,
            79_000 + index * 2_000,
        ));

        const extent = measureExtent(buildDataset(frames));

        expect(extent.columnCapacity * extent.bucketCount).toBeLessThanOrEqual(8_000_000);
    });

    it('keeps the band price actually spent its time in', () => {
        const frames = Array.from({ length: 200 }, (_unused, index) => buildFrame(
            index * 1_000,
            index < 195 ? 79_000 : 79_000 + 900_000,
        ));

        const extent = measureExtent(buildDataset(frames));
        const busiestBucket = Math.floor(79_000 / PRICE_BUCKET_SIZE);
        const highestBucket = extent.lowestBucketIndex + extent.bucketCount - 1;

        expect(busiestBucket >= extent.lowestBucketIndex && busiestBucket <= highestBucket).toBe(true);
    });

    it('never starts the band above where the data ends', () => {
        const frames = Array.from({ length: 200 }, (_unused, index) => buildFrame(
            index * 1_000,
            79_000 + index * 5_000,
        ));

        const extent = measureExtent(buildDataset(frames));

        expect(extent.bucketCount).toBeGreaterThan(0);
    });

    it('anchors the base on the first frame', () => {
        const frames = [buildFrame(1_700_000, 79_000), buildFrame(1_701_000, 79_000)];

        expect(measureExtent(buildDataset(frames)).baseTimestampMs).toBe(1_700_000);
    });
});
