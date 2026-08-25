import { buildCandleSeries, chooseBinMs } from '../../../src/app/core/candle-series.ts';
import { describe, expect, it } from 'vitest';
import type { LiquidityFrame } from '../../../src/shared/core/liquidity-frame.ts';

function buildFrame(capturedAtMs: number, midPrice: number): LiquidityFrame {
    return {
        capturedAtMs,
        bestBidPrice: midPrice - 0.5,
        bestAskPrice: midPrice + 0.5,
        bids: { lowestBucketIndex: 0, quantities: Float32Array.from([1]) },
        asks: { lowestBucketIndex: 1, quantities: Float32Array.from([1]) },
    };
}

function buildRequest(frames: readonly LiquidityFrame[], plotWidthPx = 1_000) {
    return {
        frames,
        fromMs: 0,
        toMs: 60_000,
        plotWidthPx,
        sampleIntervalMs: 1_000,
    };
}

describe('buildCandleSeries', () => {
    it('returns nothing for an empty window', () => {
        expect(buildCandleSeries(buildRequest([]))).toEqual([]);
    });

    it('gives each recorded second its own candle when there is room', () => {
        const frames = [buildFrame(0, 100), buildFrame(1_000, 110), buildFrame(2_000, 105)];

        expect(buildCandleSeries(buildRequest(frames)).length).toBe(3);
    });

    it('opens at the first price of the bin', () => {
        const frames = [buildFrame(0, 100), buildFrame(1_000, 110), buildFrame(2_000, 105)];

        expect(buildCandleSeries(buildRequest(frames, 100))[0]?.openPrice).toBe(100);
    });

    it('closes at the last price of the bin', () => {
        const frames = [buildFrame(0, 100), buildFrame(1_000, 110), buildFrame(2_000, 105)];

        expect(buildCandleSeries(buildRequest(frames, 100))[0]?.closePrice).toBe(105);
    });

    it('reaches the highest price the bin touched', () => {
        const frames = [buildFrame(0, 100), buildFrame(1_000, 130), buildFrame(2_000, 105)];

        expect(buildCandleSeries(buildRequest(frames, 100))[0]?.highPrice).toBe(130);
    });

    it('reaches the lowest price the bin touched', () => {
        const frames = [buildFrame(0, 100), buildFrame(1_000, 80), buildFrame(2_000, 105)];

        expect(buildCandleSeries(buildRequest(frames, 100))[0]?.lowPrice).toBe(80);
    });

    it('starts a new candle when the bin rolls over', () => {
        const frames = Array.from({ length: 40 }, (_unused, index) =>
            buildFrame(index * 1_000, 100 + index));

        expect(buildCandleSeries(buildRequest(frames, 200)).length).toBeGreaterThan(1);
    });

    it('leaves no gap between one candle and the next', () => {
        const frames = Array.from({ length: 40 }, (_unused, index) =>
            buildFrame(index * 1_000, 100 + index));

        const candles = buildCandleSeries(buildRequest(frames, 200));
        expect(candles[0]?.closedAtMs).toBe(candles[1]?.openedAtMs);
    });

    it('skips a frame whose book was empty, rather than charting a zero', () => {
        const frames = [buildFrame(0, 100), { ...buildFrame(1_000, 0), bestBidPrice: 0, bestAskPrice: 0 }];

        expect(buildCandleSeries(buildRequest(frames, 100))[0]?.lowPrice).toBe(100);
    });

    it('keeps the candles in the order they were recorded', () => {
        const frames = Array.from({ length: 40 }, (_unused, index) =>
            buildFrame(index * 1_000, 100 + index));

        const opened = buildCandleSeries(buildRequest(frames, 200)).map((c) => c.openedAtMs);
        expect(opened).toEqual([...opened].sort((left, right) => left - right));
    });
});

describe('chooseBinMs', () => {
    it('never bins finer than the frames were recorded at', () => {
        expect(chooseBinMs(buildRequest([], 100_000))).toBe(1_000);
    });

    it('widens the bin as the window outgrows the surface', () => {
        const narrow = chooseBinMs(buildRequest([], 1_000));
        const wide = chooseBinMs(buildRequest([], 100));

        expect(wide).toBeGreaterThan(narrow);
    });

    it('lands on a whole number of sample intervals', () => {
        expect(chooseBinMs(buildRequest([], 137)) % 1_000).toBe(0);
    });

    it('refuses a window with no width', () => {
        expect(chooseBinMs({ ...buildRequest([]), toMs: 0 })).toBe(0);
    });

    it('keeps candles at least a few pixels wide', () => {
        const request = buildRequest([], 300);
        const candleWidthPx = chooseBinMs(request) / ((request.toMs - request.fromMs) / 300);

        expect(candleWidthPx).toBeGreaterThanOrEqual(7);
    });
});
