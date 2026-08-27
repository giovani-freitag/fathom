import { describe, expect, it } from 'vitest';
import type { Drawing } from '../../../../src/shared/core/drawing.ts';
import {
    DRAWING_GRAB_TOLERANCE_PX,
    findAnchorAt,
    findDrawingAt,
} from '../../../../src/app/drawings/drawing-hit-test.ts';
import { ViewportProjector } from '../../../../src/app/core/viewport-projector.ts';

const WIDTH_PX = 1_000;
const HEIGHT_PX = 500;

/** A view a hundred seconds and a hundred units wide, so a pixel is easy arithmetic. */
const projector = new ViewportProjector({
    viewport: { fromMs: 0, toMs: 100_000, lowPrice: 0, highPrice: 100 },
    width: WIDTH_PX,
    height: HEIGHT_PX,
});

/** Where a price sits on this surface. */
function yOf(price: number): number {
    return projector.priceToY(price);
}

function buildLevel(id: string, price: number): Drawing {
    return {
        id,
        kind: 'horizontal-line',
        instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 50_000, price }],
        tone: 'phosphor',
    };
}

function buildTrend(id: string): Drawing {
    return {
        id,
        kind: 'trend-line',
        instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 20_000, price: 20 }, { atMs: 60_000, price: 60 }],
        tone: 'amber',
    };
}

function buildZone(id: string): Drawing {
    return {
        id,
        kind: 'zone',
        instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 20_000, price: 20 }, { atMs: 60_000, price: 60 }],
        tone: 'cyan',
    };
}

/** Below this, a fingertip cannot reliably land on a one-pixel line. */
const FINGERTIP_TOLERANCE_PX = 10;

describe('DRAWING_GRAB_TOLERANCE_PX', () => {
    it('is sized for a fingertip rather than a cursor', () => {
        // A tap that misses pans the chart instead, which reads as the mark
        // having been ignored.
        expect(DRAWING_GRAB_TOLERANCE_PX).toBeGreaterThanOrEqual(FINGERTIP_TOLERANCE_PX);
    });
});

describe('findDrawingAt over a zone', () => {
    it('takes a press anywhere inside it', () => {
        // A trading zone is read as an area, and hunting for its one-pixel
        // outline with a fingertip is not something anybody should have to do.
        const hit = findDrawingAt({
            drawings: [buildZone('zone')],
            projector,
            point: { x: projector.timeToX(40_000), y: yOf(40) },
        });

        expect(hit).toBe('zone');
    });

    it('takes a press just outside its edge', () => {
        const hit = findDrawingAt({
            drawings: [buildZone('zone')],
            projector,
            point: { x: projector.timeToX(40_000), y: yOf(60) - DRAWING_GRAB_TOLERANCE_PX + 1 },
        });

        expect(hit).toBe('zone');
    });

    it('leaves a press well clear of it alone', () => {
        const hit = findDrawingAt({
            drawings: [buildZone('zone')],
            projector,
            point: { x: projector.timeToX(90_000), y: yOf(90) },
        });

        expect(hit).toBeNull();
    });
});

describe('findDrawingAt', () => {
    it('finds a level the pointer is on', () => {
        const hit = findDrawingAt({
            drawings: [buildLevel('level', 50)],
            projector,
            point: { x: 10, y: yOf(50) },
        });

        expect(hit).toBe('level');
    });

    it('finds a level anywhere along the window, because that is where it is drawn', () => {
        const hit = findDrawingAt({
            drawings: [buildLevel('level', 50)],
            projector,
            point: { x: WIDTH_PX - 1, y: yOf(50) },
        });

        expect(hit).toBe('level');
    });

    it('finds a mark the pointer is within reach of', () => {
        const hit = findDrawingAt({
            drawings: [buildLevel('level', 50)],
            projector,
            point: { x: 10, y: yOf(50) + DRAWING_GRAB_TOLERANCE_PX - 1 },
        });

        expect(hit).toBe('level');
    });

    it('finds nothing further away than that', () => {
        // Grabbing a mark the pointer is nowhere near takes the press away from
        // the pan it was meant to be.
        const hit = findDrawingAt({
            drawings: [buildLevel('level', 50)],
            projector,
            point: { x: 10, y: yOf(50) + DRAWING_GRAB_TOLERANCE_PX + 1 },
        });

        expect(hit).toBeNull();
    });

    it('finds a segment along the slope it was drawn on', () => {
        const hit = findDrawingAt({
            drawings: [buildTrend('trend')],
            projector,
            point: { x: projector.timeToX(40_000), y: yOf(40) },
        });

        expect(hit).toBe('trend');
    });

    it('finds nothing past the end of a segment', () => {
        // A segment stops where the reader stopped it; grabbing where the line
        // is not drawn would grab something invisible.
        const hit = findDrawingAt({
            drawings: [buildTrend('trend')],
            projector,
            point: { x: projector.timeToX(80_000), y: yOf(80) },
        });

        expect(hit).toBeNull();
    });

    it('takes the mark drawn over the other when two overlap', () => {
        const hit = findDrawingAt({
            drawings: [buildLevel('under', 50), buildLevel('over', 50)],
            projector,
            point: { x: 10, y: yOf(50) },
        });

        expect(hit).toBe('over');
    });

    it('takes the nearer of two marks apart from each other', () => {
        const hit = findDrawingAt({
            drawings: [buildLevel('near', 50), buildLevel('far', 51)],
            projector,
            point: { x: 10, y: yOf(50) + 1 },
        });

        expect(hit).toBe('near');
    });

    it('finds nothing on a chart with nothing drawn on it', () => {
        expect(findDrawingAt({ drawings: [], projector, point: { x: 10, y: 10 } })).toBeNull();
    });
});

describe('findAnchorAt', () => {
    const trend: Drawing = {
        id: 'trend',
        kind: 'trend-line',
        instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 20_000, price: 20 }, { atMs: 80_000, price: 80 }],
        tone: 'amber',
    };

    it('answers which end the pointer is on', () => {
        const point = { x: projector.timeToX(80_000), y: projector.priceToY(80) };

        expect(findAnchorAt({ drawing: trend, projector, point })).toBe(1);
    });

    it('answers nothing halfway along, where there is no end to take', () => {
        const point = { x: projector.timeToX(50_000), y: projector.priceToY(50) };

        expect(findAnchorAt({ drawing: trend, projector, point })).toBeNull();
    });

    it('answers the end a pointer aimed at it lands a few pixels off', () => {
        // Written in pixels rather than against the tolerance itself, which
        // would follow the constant wherever it went and pin nothing.
        const point = { x: projector.timeToX(80_000) + 6, y: projector.priceToY(80) };

        expect(findAnchorAt({ drawing: trend, projector, point })).toBe(1);
    });

    it('stops well short of the line, which is grabbed for something else', () => {
        // Reshaping and moving are different gestures on the same mark, and an
        // end that reached far along the line would take presses meant to move.
        const point = { x: projector.timeToX(80_000) - 20, y: projector.priceToY(78) };

        expect(findAnchorAt({ drawing: trend, projector, point })).toBeNull();
    });

    it("looks for a level's grip where the painter draws it, not where it is pinned", () => {
        // A level crosses the whole window, so its grip sits at the middle of
        // the plot rather than at an instant that may be off screen entirely.
        const level: Drawing = {
            id: 'level',
            kind: 'horizontal-line',
            instrumentSymbol: 'BTCUSDT',
            anchors: [{ atMs: 5_000, price: 50 }],
            tone: 'phosphor',
        };

        const point = { x: WIDTH_PX / 2, y: projector.priceToY(50) };

        expect(findAnchorAt({ drawing: level, projector, point })).toBe(0);
    });
});
