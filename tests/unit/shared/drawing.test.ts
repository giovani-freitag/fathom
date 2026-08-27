import { describe, expect, it } from 'vitest';
import {
    ANCHORS_PER_KIND,
    type Drawing,
    isDrawing,
    priceAtTime,
    shiftDrawing,
} from '../../../src/shared/core/drawing.ts';

/** A level at one price. */
function buildLevel(price: number): Drawing {
    return {
        id: 'level',
        kind: 'horizontal-line',
        instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 1_000, price }],
        tone: 'phosphor',
    };
}

/** A segment between two points. */
function buildTrend(): Drawing {
    return {
        id: 'trend',
        kind: 'trend-line',
        instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 1_000, price: 100 }, { atMs: 3_000, price: 200 }],
        tone: 'amber',
    };
}

describe('isDrawing', () => {
    it('takes a mark this build knows how to draw', () => {
        expect(isDrawing(buildTrend())).toBe(true);
    });

    it('refuses a kind this build does not draw', () => {
        // Kept, it would be persisted for ever and shown by nothing.
        expect(isDrawing({ ...buildTrend(), kind: 'fibonacci-fan' })).toBe(false);
    });

    it('refuses a mark short of the anchors its kind needs', () => {
        expect(isDrawing({ ...buildTrend(), anchors: [{ atMs: 1_000, price: 100 }] })).toBe(false);
    });

    it('refuses an anchor that is not a pair of numbers', () => {
        expect(isDrawing({ ...buildLevel(100), anchors: [{ atMs: 1_000, price: null }] })).toBe(false);
    });

    it('refuses an anchor at no finite instant', () => {
        expect(isDrawing({ ...buildLevel(100), anchors: [{ atMs: Number.NaN, price: 100 }] })).toBe(false);
    });

    it('refuses a mark drawn about nothing', () => {
        expect(isDrawing({ ...buildLevel(100), instrumentSymbol: 7 })).toBe(false);
    });

    it('refuses whatever else came out of storage', () => {
        expect(isDrawing(null)).toBe(false);
    });
});

describe('priceAtTime', () => {
    it('reads a level at the price it was pinned to, whenever it is asked', () => {
        expect(priceAtTime(buildLevel(123), 9_999_999)).toBe(123);
    });

    it('reads a segment at each of the points that set it', () => {
        const trend = buildTrend();

        expect([priceAtTime(trend, 1_000), priceAtTime(trend, 3_000)]).toEqual([100, 200]);
    });

    it('reads a segment between them', () => {
        expect(priceAtTime(buildTrend(), 2_000)).toBe(150);
    });

    it('carries a segment on past the points that set it', () => {
        // A trend line is read for where it says price is going, which is beyond
        // the two points a reader put down.
        expect(priceAtTime(buildTrend(), 4_000)).toBe(250);
    });

    it('reads a segment pinned to one instant at its newer end', () => {
        const upright = { ...buildTrend(), anchors: [{ atMs: 1_000, price: 100 }, { atMs: 1_000, price: 200 }] };

        expect(priceAtTime(upright, 5_000)).toBe(200);
    });

    it('reads nothing from a mark with no anchors', () => {
        expect(priceAtTime({ ...buildLevel(100), anchors: [] }, 1_000)).toBeNull();
    });
});

describe('shiftDrawing', () => {
    it('carries a segment whole, in both time and price', () => {
        const moved = shiftDrawing(buildTrend(), { deltaMs: 500, deltaPrice: 10 });

        expect(moved.anchors).toEqual([{ atMs: 1_500, price: 110 }, { atMs: 3_500, price: 210 }]);
    });

    it('slides a level in price only', () => {
        // A level is read against the price axis and drawn across the whole
        // window, so moving it along time loses where it was pinned and shows
        // the reader nothing for it.
        const moved = shiftDrawing(buildLevel(100), { deltaMs: 500, deltaPrice: -5 });

        expect(moved.anchors).toEqual([{ atMs: 1_000, price: 95 }]);
    });

    it('keeps everything about the mark but where it sits', () => {
        const trend = buildTrend();

        const moved = shiftDrawing(trend, { deltaMs: 1, deltaPrice: 1 });

        expect({ ...moved, anchors: [] }).toEqual({ ...trend, anchors: [] });
    });
});

describe('ANCHORS_PER_KIND', () => {
    it('pins a level by one point and a segment by two', () => {
        expect(ANCHORS_PER_KIND).toEqual({ 'horizontal-line': 1, 'trend-line': 2 });
    });
});
