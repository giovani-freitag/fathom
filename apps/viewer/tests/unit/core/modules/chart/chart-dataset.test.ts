import type { LiquidityFrame } from '@fathom/contracts';
import { describe, expect, it } from 'vitest';
import {
    appendClusters,
    appendFrames,
    EMPTY_DATASET,
    newestFrameTimestamp,
    replaceDataset,
} from '@core/modules/chart/chart-dataset';

function buildFrame(capturedAtMs: number): LiquidityFrame {
    return {
        capturedAtMs,
        bestBidPrice: 100,
        bestAskPrice: 101,
        bids: { lowestBucketIndex: 9, quantities: Float32Array.from([1, 2]) },
        asks: { lowestBucketIndex: 10, quantities: Float32Array.from([3]) },
    };
}

function buildDataset(...capturedAtMs: number[]) {
    return replaceDataset({
        instrumentSymbol: 'BTCUSDT',
        window: { priceBucketSize: 10, sampleIntervalMs: 1_000, frames: capturedAtMs.map(buildFrame) },
        clusters: [],
        clusterPriceBucketSize: 10,
        gaps: [],
        previousRevision: 0,
    });
}

describe('replaceDataset', () => {
    it('advances the revision so a renderer can invalidate its cache', () => {
        expect(buildDataset(1_000).revision).toBe(1);
    });

    it('derives a saturation quantity from the loaded window', () => {
        expect(buildDataset(1_000).saturationQuantity).toBeGreaterThan(0);
    });

    it('never samples finer than one millisecond', () => {
        const dataset = replaceDataset({
            instrumentSymbol: 'BTCUSDT',
            window: { priceBucketSize: 10, sampleIntervalMs: 0, frames: [] },
            clusters: [],
            clusterPriceBucketSize: 10,
            gaps: [],
            previousRevision: 0,
        });

        expect(dataset.sampleIntervalMs).toBe(1);
    });
});

describe('appendFrames', () => {
    it('extends the window with frames newer than the last loaded one', () => {
        const dataset = buildDataset(1_000, 2_000);

        const extended = appendFrames(dataset, [buildFrame(3_000)]);

        expect(extended.frames.map((frame) => frame.capturedAtMs)).toEqual([1_000, 2_000, 3_000]);
    });

    it('drops a frame the window already holds', () => {
        const dataset = buildDataset(1_000, 2_000);

        const extended = appendFrames(dataset, [buildFrame(2_000)]);

        expect(extended.frames.length).toBe(2);
    });

    it('returns the same snapshot when nothing was new', () => {
        const dataset = buildDataset(1_000);

        expect(appendFrames(dataset, [buildFrame(1_000)])).toBe(dataset);
    });

    it('returns the same snapshot when handed no frames', () => {
        const dataset = buildDataset(1_000);

        expect(appendFrames(dataset, [])).toBe(dataset);
    });

    it('advances the revision when it did extend', () => {
        const dataset = buildDataset(1_000);

        expect(appendFrames(dataset, [buildFrame(2_000)]).revision).toBe(dataset.revision + 1);
    });

    it('holds the saturation quantity steady across a streamed frame', () => {
        const dataset = buildDataset(1_000);

        expect(appendFrames(dataset, [buildFrame(2_000)]).saturationQuantity)
            .toBe(dataset.saturationQuantity);
    });
});

describe('appendClusters', () => {
    it('drops clusters at or before the newest one held', () => {
        const dataset = {
            ...EMPTY_DATASET,
            clusters: [{
                executedAtMs: 2_000,
                priceBucketIndex: 10,
                buyQuantity: 1,
                sellQuantity: 0,
                tradeCount: 1,
                largestTradeQuantity: 1,
            }],
        };

        const extended = appendClusters(dataset, [{
            executedAtMs: 1_000,
            priceBucketIndex: 10,
            buyQuantity: 1,
            sellQuantity: 0,
            tradeCount: 1,
            largestTradeQuantity: 1,
        }]);

        expect(extended).toBe(dataset);
    });
});

describe('newestFrameTimestamp', () => {
    it('reports nothing for an empty dataset', () => {
        expect(newestFrameTimestamp(EMPTY_DATASET)).toBeNull();
    });

    it('reports the last frame in capture order', () => {
        expect(newestFrameTimestamp(buildDataset(1_000, 5_000))).toBe(5_000);
    });
});
