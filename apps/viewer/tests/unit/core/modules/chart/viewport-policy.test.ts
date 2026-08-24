import type { InstrumentCoverage } from '@fathom/contracts';
import { EMPTY_DATASET } from '@core/modules/chart/chart-dataset';
import {
    followLiveEdge,
    followTouchPrice,
    frameOnBook,
    resolveTradePriceGroupSize,
    resolveViewportBounds,
} from '@core/modules/chart/viewport-policy';
import { describe, expect, it } from 'vitest';
import { buildFrame } from '../../../../mocks/chart-services.ts';

const VIEWPORT = { fromMs: 1_000_000, toMs: 1_900_000, lowPrice: 78_000, highPrice: 79_000 };

const INSTRUMENT: InstrumentCoverage = {
    instrumentSymbol: 'BTCUSDT',
    priceBucketSize: 10,
    frameIntervalMs: 1_000,
    firstFrameAtMs: 500_000,
    lastFrameAtMs: 2_000_000,
};

function datasetWith(...frames: ReturnType<typeof buildFrame>[]) {
    return { ...EMPTY_DATASET, priceBucketSize: 10, frames };
}

describe('resolveViewportBounds', () => {
    it('starts at the first recorded frame', () => {
        const bounds = resolveViewportBounds({
            instrument: INSTRUMENT,
            priceBucketSize: 10,
            nowMs: 3_000_000,
        });

        expect(bounds.earliestMs).toBe(500_000);
    });

    it('ends at the clock, which runs ahead of the newest frame held', () => {
        const bounds = resolveViewportBounds({
            instrument: INSTRUMENT,
            priceBucketSize: 10,
            nowMs: 3_000_000,
        });

        expect(bounds.latestMs).toBe(3_000_000);
    });

    it('never ends before the newest recorded frame', () => {
        const bounds = resolveViewportBounds({
            instrument: INSTRUMENT,
            priceBucketSize: 10,
            nowMs: 1_000,
        });

        expect(bounds.latestMs).toBe(2_000_000);
    });

    it('scales the minimum price span with the recorded grid', () => {
        const bounds = resolveViewportBounds({ instrument: INSTRUMENT, priceBucketSize: 25, nowMs: 0 });

        expect(bounds.minimumPriceSpan).toBe(100);
    });

    it('survives an instrument that was never recorded', () => {
        const bounds = resolveViewportBounds({ instrument: undefined, priceBucketSize: 10, nowMs: 5_000 });

        expect(bounds.earliestMs).toBe(0);
    });
});

describe('followLiveEdge', () => {
    it('slides the window onto the newest frame', () => {
        const advanced = followLiveEdge(VIEWPORT, datasetWith(buildFrame(2_000_000)));

        expect(advanced.toMs).toBe(2_000_000);
    });

    it('keeps the span while sliding', () => {
        const advanced = followLiveEdge(VIEWPORT, datasetWith(buildFrame(2_000_000)));

        expect(advanced.toMs - advanced.fromMs).toBe(900_000);
    });

    it('does nothing when the newest frame is already on screen', () => {
        expect(followLiveEdge(VIEWPORT, datasetWith(buildFrame(1_500_000)))).toBe(VIEWPORT);
    });

    it('does nothing with an empty window', () => {
        expect(followLiveEdge(VIEWPORT, EMPTY_DATASET)).toBe(VIEWPORT);
    });
});

describe('followTouchPrice', () => {
    it('leaves the axis alone while the touch is on screen', () => {
        expect(followTouchPrice(VIEWPORT, datasetWith(buildFrame(1_500_000, 78_500)))).toBe(VIEWPORT);
    });

    it('recentres on a touch that walked off the top', () => {
        const followed = followTouchPrice(VIEWPORT, datasetWith(buildFrame(1_500_000, 80_000)));

        expect((followed.lowPrice + followed.highPrice) / 2).toBeCloseTo(80_000, 6);
    });

    it('recentres on a touch that walked off the bottom', () => {
        const followed = followTouchPrice(VIEWPORT, datasetWith(buildFrame(1_500_000, 70_000)));

        expect((followed.lowPrice + followed.highPrice) / 2).toBeCloseTo(70_000, 6);
    });

    it('keeps the price span when it recentres', () => {
        const followed = followTouchPrice(VIEWPORT, datasetWith(buildFrame(1_500_000, 80_000)));

        expect(followed.highPrice - followed.lowPrice).toBe(1_000);
    });

    it('leaves the time axis untouched', () => {
        const followed = followTouchPrice(VIEWPORT, datasetWith(buildFrame(1_500_000, 80_000)));

        expect([followed.fromMs, followed.toMs]).toEqual([VIEWPORT.fromMs, VIEWPORT.toMs]);
    });
});

describe('frameOnBook', () => {
    it('centres a placeholder range on the book', () => {
        const framed = frameOnBook(
            { ...VIEWPORT, lowPrice: 0, highPrice: 1 },
            datasetWith(buildFrame(1_500_000, 79_000)),
        );

        expect((framed.lowPrice + framed.highPrice) / 2).toBeCloseTo(79_000, 6);
    });

    it('opens on a slice of the book rather than the whole recorded range', () => {
        const framed = frameOnBook(
            { ...VIEWPORT, lowPrice: 0, highPrice: 1 },
            datasetWith(buildFrame(1_500_000, 79_000)),
        );

        expect(framed.highPrice - framed.lowPrice).toBeLessThan(79_000 * 0.02);
    });

    it('does nothing with an empty window', () => {
        expect(frameOnBook(VIEWPORT, EMPTY_DATASET)).toBe(VIEWPORT);
    });
});

describe('resolveTradePriceGroupSize', () => {
    it('stays on the stored grid while the axis is tight', () => {
        expect(resolveTradePriceGroupSize(VIEWPORT, 10)).toBe(1);
    });

    it('coarsens as the price axis widens', () => {
        const wide = { ...VIEWPORT, lowPrice: 60_000, highPrice: 90_000 };

        expect(resolveTradePriceGroupSize(wide, 10)).toBeGreaterThan(1);
    });

    it('never returns a grouping below one', () => {
        expect(resolveTradePriceGroupSize({ ...VIEWPORT, highPrice: 78_000 }, 10)).toBe(1);
    });
});
