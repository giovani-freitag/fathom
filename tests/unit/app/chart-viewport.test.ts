import { describe, expect, it } from 'vitest';
import {
    type ChartViewport,
    clampViewport,
    panViewport,
    type ViewportBounds,
    zoomViewportPrice,
    zoomViewportTime,
} from '../../../src/app/core/chart-viewport.ts';

const VIEWPORT: ChartViewport = { fromMs: 1_000, toMs: 2_000, lowPrice: 100, highPrice: 200 };

const BOUNDS: ViewportBounds = {
    earliestMs: 0,
    latestMs: 10_000,
    minimumSpanMs: 500,
    maximumSpanMs: 5_000,
    minimumPriceSpan: 10,
};

describe('panViewport', () => {
    it('shifts both axes without changing either span', () => {
        const panned = panViewport({ viewport: VIEWPORT, deltaMs: 250, deltaPrice: -20 });

        expect(panned).toEqual({ fromMs: 1_250, toMs: 2_250, lowPrice: 80, highPrice: 180 });
    });
});

describe('zoomViewportTime', () => {
    it('pins the instant under the anchor', () => {
        const zoomed = zoomViewportTime({ viewport: VIEWPORT, anchorRatio: 0.25, factor: 0.5 });

        expect(zoomed.fromMs + (zoomed.toMs - zoomed.fromMs) * 0.25).toBe(1_250);
    });

    it('narrows the span by the factor', () => {
        const zoomed = zoomViewportTime({ viewport: VIEWPORT, anchorRatio: 0.5, factor: 0.5 });

        expect(zoomed.toMs - zoomed.fromMs).toBe(500);
    });

    it('leaves the price axis untouched', () => {
        const zoomed = zoomViewportTime({ viewport: VIEWPORT, anchorRatio: 0.5, factor: 2 });

        expect([zoomed.lowPrice, zoomed.highPrice]).toEqual([100, 200]);
    });
});

describe('zoomViewportPrice', () => {
    it('pins the price under the anchor, measuring downward from the top', () => {
        const zoomed = zoomViewportPrice({ viewport: VIEWPORT, anchorRatio: 0.25, factor: 0.5 });

        expect(zoomed.highPrice - (zoomed.highPrice - zoomed.lowPrice) * 0.25).toBe(175);
    });

    it('leaves the time axis untouched', () => {
        const zoomed = zoomViewportPrice({ viewport: VIEWPORT, anchorRatio: 0.5, factor: 2 });

        expect([zoomed.fromMs, zoomed.toMs]).toEqual([1_000, 2_000]);
    });
});

describe('clampViewport', () => {
    it('leaves a viewport already inside its bounds alone', () => {
        const clamped = clampViewport(VIEWPORT, BOUNDS);

        expect(clamped).toEqual(VIEWPORT);
    });

    it('pulls a viewport back from past the latest instant', () => {
        const clamped = clampViewport({ ...VIEWPORT, fromMs: 9_500, toMs: 10_500 }, BOUNDS);

        expect([clamped.fromMs, clamped.toMs]).toEqual([9_000, 10_000]);
    });

    it('pulls a viewport back from before the earliest instant', () => {
        const clamped = clampViewport({ ...VIEWPORT, fromMs: -5_000, toMs: -4_000 }, BOUNDS);

        expect(clamped.fromMs).toBe(0);
    });

    it('widens a span narrower than the minimum', () => {
        const clamped = clampViewport({ ...VIEWPORT, fromMs: 1_000, toMs: 1_010 }, BOUNDS);

        expect(clamped.toMs - clamped.fromMs).toBe(500);
    });

    it('narrows a span wider than the maximum', () => {
        const clamped = clampViewport({ ...VIEWPORT, fromMs: 0, toMs: 9_000 }, BOUNDS);

        expect(clamped.toMs - clamped.fromMs).toBe(5_000);
    });

    it('widens a price span narrower than the minimum around its centre', () => {
        const clamped = clampViewport({ ...VIEWPORT, lowPrice: 149, highPrice: 151 }, BOUNDS);

        expect([clamped.lowPrice, clamped.highPrice]).toEqual([145, 155]);
    });
});

describe('clampViewport against a short recording', () => {
    const SHORT_RECORDING: ViewportBounds = {
        earliestMs: 1_000_000,
        latestMs: 1_600_000,
        minimumSpanMs: 5_000,
        maximumSpanMs: 90 * 24 * 60 * 60 * 1_000,
        minimumPriceSpan: 10,
    };

    it('never shows time past the newest frame', () => {
        const clamped = clampViewport(
            { ...VIEWPORT, fromMs: -2_000_000, toMs: 1_600_000 },
            SHORT_RECORDING,
        );

        expect(clamped.toMs).toBeLessThanOrEqual(SHORT_RECORDING.latestMs);
    });

    it('shrinks a span wider than the recording instead of sliding into the future', () => {
        const clamped = clampViewport(
            { ...VIEWPORT, fromMs: -2_000_000, toMs: 1_600_000 },
            SHORT_RECORDING,
        );

        expect(clamped.toMs - clamped.fromMs).toBe(600_000);
    });

    it('starts no earlier than the first frame', () => {
        const clamped = clampViewport(
            { ...VIEWPORT, fromMs: -2_000_000, toMs: 1_600_000 },
            SHORT_RECORDING,
        );

        expect(clamped.fromMs).toBe(SHORT_RECORDING.earliestMs);
    });
});
