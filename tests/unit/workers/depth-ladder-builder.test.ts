import { describe, expect, it } from 'vitest';
import { buildLiquidityFrame } from '../../../src/workers/core/depth-ladder-builder.ts';
import type { OrderBookReading } from '../../../src/workers/core/depth-types.ts';

function buildReading(overrides: Partial<OrderBookReading> = {}): OrderBookReading {
    return {
        bestBidPrice: 1_000,
        bestAskPrice: 1_001,
        bidQuantityByPrice: new Map([[1_000, 5], [990, 3]]),
        askQuantityByPrice: new Map([[1_001, 7], [1_010, 2]]),
        ...overrides,
    };
}

describe('buildLiquidityFrame', () => {
    it('keeps resting bid size out of the ask ladder when both share a bucket', () => {
        const reading = buildReading({
            bidQuantityByPrice: new Map([[1_000.4, 5]]),
            askQuantityByPrice: new Map([[1_000.6, 7]]),
            bestBidPrice: 1_000.4,
            bestAskPrice: 1_000.6,
        });

        const frame = buildLiquidityFrame({
            reading,
            capturedAtMs: 1_000,
            priceBucketSize: 10,
            recordedPriceRangeRatio: 0.02,
        });

        expect([
            frame.bids.quantities[100 - frame.bids.lowestBucketIndex],
            frame.asks.quantities[100 - frame.asks.lowestBucketIndex],
        ]).toEqual([5, 7]);
    });

    it('sums levels that fall in the same bucket on one side', () => {
        const reading = buildReading({
            bidQuantityByPrice: new Map([[1_000, 5], [1_002, 4]]),
            bestBidPrice: 1_002,
            bestAskPrice: 1_003,
        });

        const frame = buildLiquidityFrame({
            reading,
            capturedAtMs: 1_000,
            priceBucketSize: 10,
            recordedPriceRangeRatio: 0.02,
        });

        expect(frame.bids.quantities[100 - frame.bids.lowestBucketIndex]).toBe(9);
    });

    it('starts the ask ladder at the bucket holding the best ask', () => {
        const frame = buildLiquidityFrame({
            reading: buildReading(),
            capturedAtMs: 1_000,
            priceBucketSize: 10,
            recordedPriceRangeRatio: 0.02,
        });

        expect(frame.asks.lowestBucketIndex).toBe(100);
    });

    it('excludes levels outside the recorded range', () => {
        const reading = buildReading({
            bidQuantityByPrice: new Map([[1_000, 5], [500, 99]]),
        });

        const frame = buildLiquidityFrame({
            reading,
            capturedAtMs: 1_000,
            priceBucketSize: 10,
            recordedPriceRangeRatio: 0.02,
        });

        expect([...frame.bids.quantities].reduce((running, value) => running + value, 0)).toBe(5);
    });

    it('carries the touch through untouched', () => {
        const frame = buildLiquidityFrame({
            reading: buildReading(),
            capturedAtMs: 4_242,
            priceBucketSize: 10,
            recordedPriceRangeRatio: 0.02,
        });

        expect([frame.capturedAtMs, frame.bestBidPrice, frame.bestAskPrice]).toEqual([4_242, 1_000, 1_001]);
    });
});
