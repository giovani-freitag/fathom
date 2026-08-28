import { describe, expect, it } from 'vitest';
import {
    ANCHORS_PER_KIND,
    boundDrawing,
    type Drawing,
    DRAWING_KINDS,
    isDrawing,
    isTransientKind,
    moveDrawingAnchor,
    priceAtTime,
    resolveDrawingLook,
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
    it('pins a level by one point, and everything that covers ground by two', () => {
        expect(ANCHORS_PER_KIND).toEqual({
            'horizontal-line': 1,
            'trend-line': 2,
            zone: 2,
            fibonacci: 2,
            measure: 2,
        });
    });

    it('says how to pin every kind the dock offers', () => {
        expect(DRAWING_KINDS.every((kind) => ANCHORS_PER_KIND[kind] > 0)).toBe(true);
    });
});

describe('boundDrawing', () => {
    it('boxes a zone whichever way round it was dragged out', () => {
        const dragged: Drawing = {
            ...buildTrend(),
            kind: 'zone',
            anchors: [{ atMs: 3_000, price: 100 }, { atMs: 1_000, price: 200 }],
        };

        expect(boundDrawing(dragged))
            .toEqual({ fromMs: 1_000, toMs: 3_000, lowPrice: 100, highPrice: 200 });
    });

    it('boxes nothing when a mark has only one anchor', () => {
        expect(boundDrawing(buildLevel(100))).toBeNull();
    });
});

describe('priceAtTime of a zone', () => {
    it('reads no price, because a zone is an area and not a path', () => {
        // Answered with the diagonal between its corners, a zone would be
        // grabbable along a line nobody drew.
        const zone: Drawing = { ...buildTrend(), kind: 'zone' };

        expect(priceAtTime(zone, 2_000)).toBeNull();
    });

});

describe('resolveDrawingLook', () => {
    it('draws a mark the way it says to', () => {
        const styled: Drawing = { ...buildLevel(100), width: 'thick', style: 'dashed' };

        expect(resolveDrawingLook(styled)).toEqual({ width: 'thick', style: 'dashed' });
    });

    it('draws a mark stored before either existed anyway', () => {
        // It says nothing about weight or line, and refusing to draw it would
        // lose a mark a reader left in an earlier session.
        expect(resolveDrawingLook(buildLevel(100))).toEqual({ width: 'medium', style: 'solid' });
    });

    it('draws a mark naming a weight this build does not have', () => {
        const foreign = { ...buildLevel(100), width: 'hairline' } as unknown as Drawing;

        expect(resolveDrawingLook(foreign).width).toBe('medium');
    });
});

describe('moveDrawingAnchor', () => {
    it('puts the end it was handed where it was told', () => {
        const trend = buildTrend();

        const reshaped = moveDrawingAnchor(trend, 1, { atMs: 9_000, price: 90 });

        expect(reshaped.anchors[1]).toEqual({ atMs: 9_000, price: 90 });
    });

    it('leaves the other end where it was drawn', () => {
        const trend = buildTrend();

        const reshaped = moveDrawingAnchor(trend, 1, { atMs: 9_000, price: 90 });

        expect(reshaped.anchors[0]).toEqual(trend.anchors[0]);
    });

    it('keeps a level pinned to the instant it was left at', () => {
        // Nothing on screen says where along time a level sits, so a drag that
        // rewrote it would lose that for no visible gain.
        const level = buildLevel(100);

        const reshaped = moveDrawingAnchor(level, 0, { atMs: 9_000, price: 90 });

        expect(reshaped.anchors[0]).toEqual({ atMs: level.anchors[0]!.atMs, price: 90 });
    });

    it('hands back the same mark when there is no such end', () => {
        const level = buildLevel(100);

        expect(moveDrawingAnchor(level, 3, { atMs: 9_000, price: 90 })).toBe(level);
    });
});

describe('isTransientKind', () => {
    it('says a measurement is read and then done with', () => {
        expect(isTransientKind('measure')).toBe(true);
    });

    it('says a mark a reader drew is theirs to keep', () => {
        expect(DRAWING_KINDS.filter((kind) => !isTransientKind(kind)))
            .toEqual(['horizontal-line', 'trend-line', 'zone', 'fibonacci']);
    });
});
