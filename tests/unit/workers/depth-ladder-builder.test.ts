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

describe('buildLiquidityFrame on a wide grid', () => {
    // Five prices inside one thousand-dollar band, none of them large.
    const crowded = buildReading({
        bidQuantityByPrice: new Map([[999, 5], [998, 4], [997, 4], [996, 3], [995, 3]]),
        askQuantityByPrice: new Map([[1_001, 7]]),
        bestBidPrice: 999,
    });

    it('adds a band up by default, which is what a narrow bucket is asking', () => {
        const frame = buildLiquidityFrame({
            reading: crowded,
            capturedAtMs: 1_000,
            priceBucketSize: 1_000,
            recordedPriceRangeRatio: 1,
        });

        const band = Math.max(...frame.bids.quantities);

        expect(band).toBe(19);
    });

    it('takes the largest order in the band when asked for the largest', () => {
        // A thousand-dollar band near the price swallows a dense book and reads
        // in the thousands, while the same band far away holds two orders and
        // reads in tens. On one colour ramp the far one disappears.
        const frame = buildLiquidityFrame({
            reading: crowded,
            capturedAtMs: 1_000,
            priceBucketSize: 1_000,
            recordedPriceRangeRatio: 1,
            combine: 'largest',
        });

        const band = Math.max(...frame.bids.quantities);

        expect(band).toBe(5);
    });

    it('leaves a band holding one order alone either way', () => {
        const lone = buildReading({
            bidQuantityByPrice: new Map([[999, 5]]),
            askQuantityByPrice: new Map([[1_001, 7]]),
            bestBidPrice: 999,
        });
        const of = (combine: 'sum' | 'largest'): number => Math.max(...buildLiquidityFrame({
            reading: lone,
            capturedAtMs: 1_000,
            priceBucketSize: 1_000,
            recordedPriceRangeRatio: 1,
            combine,
        }).bids.quantities);

        expect([of('sum'), of('largest')]).toEqual([5, 5]);
    });
});
