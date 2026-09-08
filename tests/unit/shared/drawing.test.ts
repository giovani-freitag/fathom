import { FIRST_VENUE } from '../../../src/shared/core/recording-control.ts';
import { describe, expect, it } from 'vitest';
import {
    ANCHORS_PER_KIND,
    boundDrawing,
    type Drawing,
    DRAWING_KINDS,
    EMOJI_GLYPHS,
    isDrawing,
    isPathKind,
    isRollingKind,
    MAXIMUM_GLYPH_LENGTH,
    readDrawingFields,
    isTransientKind,
    moveDrawingAnchor,
    MAXIMUM_LABEL_LENGTH,
    priceAtTime,
    readStoredGlyph,
    readStoredLabel,
    resolveDrawingLabel,
    resolveDrawingLook,
    shiftDrawing,
} from '../../../src/shared/core/drawing.ts';

/** A level at one price. */
function buildLevel(price: number): Drawing {
    return {
        id: 'level',
        kind: 'horizontal-line',
        venue: FIRST_VENUE, instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 1_000, price }],
        tone: 'phosphor',
    };
}

/** A segment between two points. */
function buildTrend(): Drawing {
    return {
        id: 'trend',
        kind: 'trend-line',
        venue: FIRST_VENUE, instrumentSymbol: 'BTCUSDT',
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
    it('pins a level by one point, ground by two, and a path by at least one', () => {
        // A path is the one kind whose count is a floor: it starts on the press
        // and grows for as long as the hand keeps moving.
        expect(ANCHORS_PER_KIND).toEqual({
            'horizontal-line': 1,
            'trend-line': 2,
            zone: 2,
            fibonacci: 2,
            measure: 2,
            freehand: 1,
            highlighter: 1,
            emoji: 1,
            laser: 1,
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
            .toEqual([
                'horizontal-line', 'trend-line', 'zone', 'fibonacci',
                'freehand', 'highlighter', 'emoji',
            ]);
    });
});

describe('a path a reader drew', () => {
    const STROKE: Drawing = {
        id: 'stroke',
        kind: 'freehand',
        venue: FIRST_VENUE,
        instrumentSymbol: 'BTCUSDT',
        anchors: [
            { atMs: 1_000, price: 100 },
            { atMs: 1_100, price: 104 },
            { atMs: 1_200, price: 99 },
        ],
        tone: 'phosphor',
    };

    it('loads back with every anchor it was drawn with', () => {
        // The count in the table is a floor for a path. Read as an exact number,
        // every stroke a reader had drawn would be dropped on the next load —
        // and dropped silently, because a mark this build cannot place is meant
        // to be discarded.
        expect(isDrawing(STROKE)).toBe(true);
    });

    it('is still refused when it has no anchors at all', () => {
        expect(isDrawing({ ...STROKE, anchors: [] })).toBe(false);
    });

    it('says which kinds are drawn by dragging a path', () => {
        expect(DRAWING_KINDS.filter((kind) => isPathKind(kind)))
            .toEqual(['freehand', 'highlighter', 'laser']);
    });
});

describe('resolveDrawingLabel', () => {
    const LEVEL: Drawing = {
        id: 'level',
        kind: 'horizontal-line',
        venue: FIRST_VENUE, instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 1_000, price: 100 }],
        tone: 'phosphor',
    };

    it('reads back the name a reader typed', () => {
        const label = resolveDrawingLabel({ ...LEVEL, label: 'support' });

        expect(label).toBe('support');
    });

    it('has no name for a mark that was never named', () => {
        const label = resolveDrawingLabel(LEVEL);

        expect(label).toBeNull();
    });

    it('has no name for a mark named nothing but spaces', () => {
        const label = resolveDrawingLabel({ ...LEVEL, label: '   ' });

        expect(label).toBeNull();
    });

    it('drops the spaces around a name', () => {
        const label = resolveDrawingLabel({ ...LEVEL, label: '  support  ' });

        expect(label).toBe('support');
    });

    it('cuts a name that would run across the chart', () => {
        const label = resolveDrawingLabel({ ...LEVEL, label: 'x'.repeat(500) });

        expect(label).toHaveLength(MAXIMUM_LABEL_LENGTH);
    });

    it('reads a name back untouched for a field being typed into', () => {
        const stored = readStoredLabel({ ...LEVEL, label: '  suporte ' });

        expect(stored).toBe('  suporte ');
    });

    it('reads back an empty name for a mark that was never named', () => {
        expect(readStoredLabel(LEVEL)).toBe('');
    });

    it('has no name for storage that held something other than text', () => {
        const stored = { ...LEVEL, label: { text: 'support' } } as unknown as Drawing;

        expect(resolveDrawingLabel(stored)).toBeNull();
    });
});

describe('the mark an emoji shows', () => {
    const PINNED: Drawing = {
        id: 'pin',
        kind: 'emoji',
        venue: FIRST_VENUE,
        instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 1_000, price: 100 }],
        tone: 'phosphor',
    };

    it('falls back to the first the tool offers where none was stored', () => {
        // Every kind before this one drew its own shape, so a mark stored by an
        // older build carries no glyph at all.
        expect(readStoredGlyph(PINNED)).toBe(EMOJI_GLYPHS[0]);
    });

    it('shows the one the reader chose', () => {
        expect(readStoredGlyph({ ...PINNED, glyph: EMOJI_GLYPHS[3]! })).toBe(EMOJI_GLYPHS[3]);
    });

    it('refuses a glyph longer than any emoji is', () => {
        // The reader's own text on their own chart, so it is bounded rather
        // than trusted: a stored string of any length would be drawn.
        expect(isDrawing({ ...PINNED, glyph: 'x'.repeat(MAXIMUM_GLYPH_LENGTH + 1) })).toBe(false);
    });

    it('takes one as long as an emoji with a tone and a flag on it', () => {
        expect(isDrawing({ ...PINNED, glyph: 'x'.repeat(MAXIMUM_GLYPH_LENGTH) })).toBe(true);
    });
});

describe('a laser', () => {
    it('is never kept, like the measurement beside it', () => {
        expect(isTransientKind('laser')).toBe(true);
    });

    it('is the one path that drops its oldest points', () => {
        // A pen keeps the whole stroke because the stroke is the point of it. A
        // laser is where the hand is now and where it just was.
        expect(DRAWING_KINDS.filter((kind) => isRollingKind(kind))).toEqual(['laser']);
    });
});

describe('the look controls a kind is offered', () => {
    it('offers a line only to the kinds the painter breaks the line of', () => {
        // The rest each overrule it: a highlighter and a trail are forced
        // solid, retracements set their own dash, an emoji has no line.
        const styled = DRAWING_KINDS.filter((kind) => readDrawingFields(kind).hasStyle);

        expect([...styled].sort()).toEqual(['freehand', 'horizontal-line', 'measure', 'trend-line', 'zone']);
    });

    it('keeps the colour away from the kinds that paint their own', () => {
        // A measurement is coloured by which way it was dragged, and an emoji
        // paints over whatever was asked for.
        const toneless = DRAWING_KINDS.filter((kind) => !readDrawingFields(kind).hasTone);

        expect([...toneless].sort()).toEqual(['emoji', 'measure']);
    });

    it('asks only the emoji for a glyph, since it is the only one that shows one', () => {
        const glyphed = DRAWING_KINDS.filter((kind) => readDrawingFields(kind).hasGlyph);

        expect(glyphed).toEqual(['emoji']);
    });

    it('keeps a name away from a mark nobody keeps', () => {
        // A name is read later, and these two are gone by then.
        const unnameable = DRAWING_KINDS.filter((kind) => !readDrawingFields(kind).hasLabel);

        expect([...unnameable].sort()).toEqual(['laser', 'measure']);
    });
});
