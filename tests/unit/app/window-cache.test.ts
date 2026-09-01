import { describe, expect, it } from 'vitest';
import type { FrameRegion } from '../../../src/shared/core/frame-merge.ts';
import type { LiquidityFrame, LiquidityFrameWindow } from '../../../src/shared/core/liquidity-frame.ts';
import { WindowCache } from '../../../src/app/core/window-cache.ts';

const KEY = 'BTCUSDT|chunks|3520|900000|77000-80000';

/** A reading covering a region, with one instant at each end of it. */
function buildReading(region: FrameRegion): LiquidityFrameWindow {
    const buildFrame = (capturedAtMs: number): LiquidityFrame => ({
        capturedAtMs,
        bestBidPrice: (region.lowPrice + region.highPrice) / 2,
        bestAskPrice: (region.lowPrice + region.highPrice) / 2 + 10,
        bids: {
            lowestBucketIndex: Math.floor(region.lowPrice / 10),
            quantities: new Float32Array(Math.max(1, Math.floor((region.highPrice - region.lowPrice) / 10))).fill(2),
        },
        asks: { lowestBucketIndex: 0, quantities: new Float32Array(0) },
    });
    return {
        priceBucketSize: 10,
        sampleIntervalMs: 1_000,
        frames: [buildFrame(region.fromMs), buildFrame(region.toMs)],
    };
}

const WHOLE: FrameRegion = { fromMs: 1_000_000, toMs: 1_900_000, lowPrice: 78_000, highPrice: 79_000 };

describe('what a reader already holds', () => {
    it('asks for nothing when it has been there before', () => {
        // Walking back over a stretch and forward again is the gesture a chart
        // is used with more than any other, and it cost the whole window twice.
        const cache = new WindowCache();
        cache.keep(KEY, WHOLE, buildReading(WHOLE));

        const plan = cache.plan(KEY, WHOLE);

        expect(plan.missing).toEqual([]);
    });

    it('asks only for the stretch of time that came into view', () => {
        const cache = new WindowCache();
        cache.keep(KEY, WHOLE, buildReading(WHOLE));

        const plan = cache.plan(KEY, { ...WHOLE, fromMs: 800_000, toMs: 1_700_000 });

        expect(plan.missing).toEqual([
            { fromMs: 800_000, toMs: 1_000_000, lowPrice: 78_000, highPrice: 79_000 },
        ]);
    });

    it('asks only for the prices that came into view', () => {
        const cache = new WindowCache();
        cache.keep(KEY, WHOLE, buildReading(WHOLE));

        const plan = cache.plan(KEY, { ...WHOLE, lowPrice: 77_500, highPrice: 78_500 });

        expect(plan.missing).toEqual([
            { fromMs: 1_000_000, toMs: 1_900_000, lowPrice: 77_500, highPrice: 78_000 },
        ]);
    });

    it('asks for both when the drag went across and up at once', () => {
        // The case the old stitching gave up on: any move in price threw the
        // whole window away and the saving on the time axis went with it.
        const cache = new WindowCache();
        cache.keep(KEY, WHOLE, buildReading(WHOLE));

        const plan = cache.plan(KEY, {
            fromMs: 800_000, toMs: 1_700_000, lowPrice: 78_500, highPrice: 79_500,
        });

        expect(plan.missing).toEqual([
            { fromMs: 800_000, toMs: 1_000_000, lowPrice: 78_500, highPrice: 79_500 },
            { fromMs: 1_000_000, toMs: 1_700_000, lowPrice: 79_000, highPrice: 79_500 },
        ]);
    });

    it('never asks for the corner twice', () => {
        // Cut the other way round, the stretch of time and the stretch of price
        // share their corner, and a corner asked for twice is paid for twice.
        const cache = new WindowCache();
        cache.keep(KEY, WHOLE, buildReading(WHOLE));

        const plan = cache.plan(KEY, {
            fromMs: 800_000, toMs: 1_700_000, lowPrice: 78_500, highPrice: 79_500,
        });

        const overlapping = plan.missing.filter((one, index) => plan.missing.some((other, at) => (
            at !== index && one.fromMs < other.toMs && other.fromMs < one.toMs
                && one.lowPrice < other.highPrice && other.lowPrice < one.highPrice
        )));
        expect(overlapping).toEqual([]);
    });

    it('asks for the whole thing when the reader jumped somewhere else', () => {
        const cache = new WindowCache();
        cache.keep(KEY, WHOLE, buildReading(WHOLE));
        const elsewhere = { fromMs: 5_000_000, toMs: 5_900_000, lowPrice: 78_000, highPrice: 79_000 };

        const plan = cache.plan(KEY, elsewhere);

        expect([plan.held, plan.missing]).toEqual([null, [elsewhere]]);
    });

    it('keeps nothing from a reading of another picture', () => {
        // A grid is what makes two readings the same picture, and the key is
        // what carries it.
        const cache = new WindowCache();
        cache.keep(KEY, WHOLE, buildReading(WHOLE));

        const plan = cache.plan('BTCUSDT|chunks|3520|3600000|77000-80000', WHOLE);

        expect(plan.missing).toEqual([WHOLE]);
    });

    it('lets go of the readings it has not used for longest', () => {
        const cache = new WindowCache();
        for (let step = 0; step < 12; step += 1) {
            const region = { ...WHOLE, fromMs: step * 10_000_000, toMs: step * 10_000_000 + 900_000 };
            cache.keep(KEY, region, buildReading(region));
        }

        const plan = cache.plan(KEY, { ...WHOLE, fromMs: 0, toMs: 900_000 });

        expect(plan.missing.length).toBe(1);
    });
});
