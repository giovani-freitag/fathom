import type { InstrumentCoverage } from '../../../src/shared/core/api-contract.ts';
import { type ChartDataset, EMPTY_DATASET } from '../../../src/app/core/chart-dataset.ts';
import {
    followLiveEdge,
    followDrawnPrice,
    frameOnBook,
    resolveRecordedSpanMs,
    resolveTradePriceGroupSize,
    resolveViewportBounds,
} from '../../../src/app/core/viewport-policy.ts';
import { describe, expect, it } from 'vitest';
import { buildFrame } from '../../mocks/chart-services.ts';

const VIEWPORT = { fromMs: 1_000_000, toMs: 1_900_000, lowPrice: 78_000, highPrice: 79_000 };

const FLAT_BAR = {
    openedAtMs: 0, closedAtMs: 5_000,
    openPrice: 79_000, highPrice: 79_000, lowPrice: 79_000, closePrice: 79_000,
    buyVolume: 0, sellVolume: 0, tradeCount: 0,
    expectedFrames: 5, frameCount: 5, isClosed: true,
    firstFrameAtMs: 0, lastFrameAtMs: 4_000,
};

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

function barsSpanning(lowPrice: number, highPrice: number) {
    return {
        ...EMPTY_DATASET.bars,
        bars: [{ ...FLAT_BAR, lowPrice, highPrice, openPrice: lowPrice, closePrice: highPrice }],
    };
}

describe('resolveViewportBounds', () => {
    it('starts at the first recorded frame', () => {
        const bounds = resolveViewportBounds({
            instrument: INSTRUMENT,
            priceBucketSize: 10,
            nowMs: 3_000_000,
            rightMarginMs: 0,
        });

        expect(bounds.earliestMs).toBe(500_000);
    });

    it('ends at the clock, which runs ahead of the newest frame held', () => {
        const bounds = resolveViewportBounds({
            instrument: INSTRUMENT,
            priceBucketSize: 10,
            nowMs: 3_000_000,
            rightMarginMs: 0,
        });

        expect(bounds.latestMs).toBe(3_000_000);
    });

    it('never ends before the newest recorded frame', () => {
        const bounds = resolveViewportBounds({
            instrument: INSTRUMENT,
            priceBucketSize: 10,
            nowMs: 1_000,
            rightMarginMs: 0,
        });

        expect(bounds.latestMs).toBe(2_000_000);
    });

    it('keeps room after the edge for the bar being built', () => {
        // Otherwise the newest bar is pressed against the axis, with nowhere to
        // show what is left of it.
        const bounds = resolveViewportBounds({
            instrument: INSTRUMENT,
            priceBucketSize: 10,
            nowMs: 3_000_000,
            rightMarginMs: 60_000,
        });

        expect(bounds.latestMs).toBe(3_060_000);
    });

    it('scales the minimum price span with the recorded grid', () => {
        const bounds = resolveViewportBounds({ instrument: INSTRUMENT, priceBucketSize: 25, nowMs: 0, rightMarginMs: 0 });

        expect(bounds.minimumPriceSpan).toBe(100);
    });

    it('survives an instrument that was never recorded', () => {
        const bounds = resolveViewportBounds({ instrument: undefined, priceBucketSize: 10, nowMs: 5_000, rightMarginMs: 0 });

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

const BOOK_ONLY = { isDepthVisible: true, isCandleOverlayVisible: false };

describe('followDrawnPrice', () => {
    it('leaves the axis alone while the touch is on screen', () => {
        const dataset = datasetWith(buildFrame(1_500_000, 78_500));

        expect(followDrawnPrice(VIEWPORT, dataset, BOOK_ONLY)).toBe(VIEWPORT);
    });

    it('recentres on a touch that walked off the top', () => {
        const dataset = datasetWith(buildFrame(1_500_000, 80_000));

        const followed = followDrawnPrice(VIEWPORT, dataset, BOOK_ONLY);

        expect((followed.lowPrice + followed.highPrice) / 2).toBeCloseTo(80_000, 6);
    });

    it('recentres on a touch that walked off the bottom', () => {
        const dataset = datasetWith(buildFrame(1_500_000, 70_000));

        const followed = followDrawnPrice(VIEWPORT, dataset, BOOK_ONLY);

        expect((followed.lowPrice + followed.highPrice) / 2).toBeCloseTo(70_000, 6);
    });

    it('keeps the price span when it recentres', () => {
        // The band the reader left the depth map on is the band it stays on;
        // an axis that crept wider every hour would read differently by noon.
        const dataset = datasetWith(buildFrame(1_500_000, 80_000));

        const followed = followDrawnPrice(VIEWPORT, dataset, BOOK_ONLY);

        expect(followed.highPrice - followed.lowPrice).toBe(1_000);
    });

    it('leaves the time axis untouched', () => {
        const dataset = datasetWith(buildFrame(1_500_000, 80_000));

        const followed = followDrawnPrice(VIEWPORT, dataset, BOOK_ONLY);

        expect([followed.fromMs, followed.toMs]).toEqual([VIEWPORT.fromMs, VIEWPORT.toMs]);
    });

    it('reaches a bar that the band does not, widening only as far as it must', () => {
        // Widening the window over a stretch the price has since travelled away
        // from otherwise draws candles nobody can see.
        const dataset = {
            ...datasetWith(buildFrame(1_500_000, 78_500)),
            bars: barsSpanning(76_000, 78_600),
        };

        const followed = followDrawnPrice(VIEWPORT, dataset, {
            isDepthVisible: true,
            isCandleOverlayVisible: true,
        });

        expect(followed.lowPrice).toBeLessThan(76_000);
        expect(followed.highPrice).toBeGreaterThan(78_600);
    });

    it('ignores bars on a chart that is not drawing them', () => {
        const dataset = {
            ...datasetWith(buildFrame(1_500_000, 78_500)),
            bars: barsSpanning(76_000, 78_600),
        };

        expect(followDrawnPrice(VIEWPORT, dataset, BOOK_ONLY)).toBe(VIEWPORT);
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

describe('resolveRecordedSpanMs', () => {
    it('measures between the first and newest recorded frame', () => {
        expect(resolveRecordedSpanMs([INSTRUMENT], 'BTCUSDT')).toBe(1_500_000);
    });

    it('reports nothing for an instrument that was never recorded', () => {
        expect(resolveRecordedSpanMs([{ ...INSTRUMENT, firstFrameAtMs: null }], 'BTCUSDT')).toBe(0);
    });

    it('reports nothing when no instrument is chosen', () => {
        expect(resolveRecordedSpanMs([INSTRUMENT], null)).toBe(0);
    });

    it('reports nothing for an unknown instrument', () => {
        expect(resolveRecordedSpanMs([INSTRUMENT], 'ETHUSDT')).toBe(0);
    });
});

describe('frameOnBook without the book', () => {
    function buildDataset(barRange: readonly [number, number]): ChartDataset {
        return {
            ...EMPTY_DATASET,
            frames: [buildFrame(1_000, 79_000)],
            bars: {
                instrumentSymbol: 'BTCUSDT',
                intervalMs: 5_000,
                warmupBarsRequested: 0,
                warmupBarsReturned: 0,
                bars: [
                    { ...FLAT_BAR, lowPrice: barRange[0], highPrice: barRange[0] },
                    { ...FLAT_BAR, lowPrice: barRange[1], highPrice: barRange[1] },
                ],
            },
        };
    }

    it('frames on the price once the book is not the thing being drawn', () => {
        // A band wide enough to hold the book leaves every candle a sliver when
        // the candles are the only thing on the axis.
        const framed = frameOnBook(VIEWPORT, buildDataset([78_900, 79_100]), false);

        expect(framed.highPrice - framed.lowPrice).toBeLessThan(400);
        expect(framed.lowPrice).toBeLessThan(78_900);
        expect(framed.highPrice).toBeGreaterThan(79_100);
    });

    it('keeps the band the book needs while the book is drawn', () => {
        const framed = frameOnBook(VIEWPORT, buildDataset([78_900, 79_100]), true);

        expect(framed.highPrice - framed.lowPrice).toBeGreaterThan(400);
    });

    it('falls back to the book when there are no bars to frame on', () => {
        const framed = frameOnBook(VIEWPORT, { ...EMPTY_DATASET, frames: [buildFrame(1_000, 79_000)] }, false);

        expect(framed.highPrice - framed.lowPrice).toBeGreaterThan(400);
    });

    it('gives a window where price never moved a band it can still draw in', () => {
        const framed = frameOnBook(VIEWPORT, buildDataset([79_000, 79_000]), false);

        expect(framed.highPrice).toBeGreaterThan(framed.lowPrice);
    });
});

describe('followLiveEdge keeping room after the newest bar', () => {
    it('runs the edge past the newest frame by the room asked for', () => {
        const dataset = datasetWith(buildFrame(1_950_000, 78_500));

        const followed = followLiveEdge(VIEWPORT, dataset, 30_000);

        expect(followed.toMs).toBe(1_980_000);
    });

    it('keeps the span while it does so', () => {
        const dataset = datasetWith(buildFrame(1_950_000, 78_500));

        const followed = followLiveEdge(VIEWPORT, dataset, 30_000);

        expect(followed.toMs - followed.fromMs).toBe(VIEWPORT.toMs - VIEWPORT.fromMs);
    });

    it('stays put once the room is already there', () => {
        // The edge is ahead of the newest frame by design; that is not a reason
        // to keep sliding it.
        const dataset = datasetWith(buildFrame(1_880_000, 78_500));

        expect(followLiveEdge(VIEWPORT, dataset, 20_000)).toBe(VIEWPORT);
    });
});
