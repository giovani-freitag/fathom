import { beforeEach, describe, expect, it } from 'vitest';
import { RENDER_PALETTE } from '../../../../src/app/painting/render-palette.ts';
import { buildPaintContext, createRecordingContext, type RecordingContext } from '../../../mocks/canvas-context.ts';
import { DEFAULT_VIEWPORT } from '../../../mocks/canvas-context.ts';
import { type Drawing, FIBONACCI_RATIOS } from '../../../../src/shared/core/drawing.ts';
import {
    describeDrawings,
    DrawingPainter,
    EMPTY_DRAWINGS_VIEW,
} from '../../../../src/app/drawings/drawing-painter.ts';

const MID_PRICE = (DEFAULT_VIEWPORT.lowPrice + DEFAULT_VIEWPORT.highPrice) / 2;
const MID_MS = (DEFAULT_VIEWPORT.fromMs + DEFAULT_VIEWPORT.toMs) / 2;

function buildLevel(overrides: Partial<Drawing> = {}): Drawing {
    return {
        id: 'level',
        kind: 'horizontal-line',
        instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: MID_MS, price: MID_PRICE }],
        tone: 'phosphor',
        ...overrides,
    };
}

function buildTrend(overrides: Partial<Drawing> = {}): Drawing {
    return {
        id: 'trend',
        kind: 'trend-line',
        instrumentSymbol: 'BTCUSDT',
        anchors: [
            { atMs: DEFAULT_VIEWPORT.fromMs, price: DEFAULT_VIEWPORT.lowPrice },
            { atMs: DEFAULT_VIEWPORT.toMs, price: DEFAULT_VIEWPORT.highPrice },
        ],
        tone: 'amber',
        ...overrides,
    };
}

/** A paint context whose chart is drawn about one contract, carrying some marks. */
function buildContext(
    recording: RecordingContext,
    drawings: Partial<typeof EMPTY_DRAWINGS_VIEW>,
): ReturnType<typeof buildPaintContext> {
    return buildPaintContext(recording, {
        dataset: { instrumentSymbol: 'BTCUSDT' },
        drawings: { ...EMPTY_DRAWINGS_VIEW, ...drawings },
    });
}

describe('DrawingPainter deciding whether to draw', () => {
    const painter = new DrawingPainter();
    let recording: RecordingContext;

    beforeEach(() => { recording = createRecordingContext(); });

    it('draws nothing on a chart with no marks on it', () => {
        expect(painter.isDrawn(buildContext(recording, {}).request)).toBe(false);
    });

    it('draws the marks left about the contract on screen', () => {
        expect(painter.isDrawn(buildContext(recording, { settled: [buildLevel()] }).request)).toBe(true);
    });

    it('leaves a mark drawn about another contract alone', () => {
        // One reader's levels on Bitcoin have nothing to say about Ether, and a
        // price from one chart drawn on the other is worse than no line at all.
        const foreign = buildLevel({ instrumentSymbol: 'ETHUSDT' });

        expect(painter.isDrawn(buildContext(recording, { settled: [foreign] }).request)).toBe(false);
    });

    it('draws a mark still being dragged out', () => {
        expect(painter.isDrawn(buildContext(recording, { draft: buildTrend() }).request)).toBe(true);
    });
});

describe('DrawingPainter drawing a level', () => {
    const painter = new DrawingPainter();
    let recording: RecordingContext;

    beforeEach(() => {
        recording = createRecordingContext();
    });

    it('carries it across the whole plot', () => {
        const paint = buildContext(recording, { settled: [buildLevel()] });

        painter.paint(paint);

        const [from] = recording.callsTo('moveTo');
        const [to] = recording.callsTo('lineTo');
        expect([from?.args[0], to?.args[0]]).toEqual([0, paint.layout.plotWidth]);
    });

    it('draws it at the price it was pinned to', () => {
        const paint = buildContext(recording, { settled: [buildLevel()] });

        painter.paint(paint);

        expect(recording.callsTo('moveTo')[0]?.args[1]).toBe(paint.projector.priceToY(MID_PRICE));
    });

    it('draws it in the tone it was given', () => {
        painter.paint(buildContext(recording, { settled: [buildLevel({ tone: 'ask' })] }));

        expect(recording.callsTo('stroke')[0]?.strokeStyle).not.toBe('');
    });

    it('grips the mark that is selected, so what a drag would move is visible', () => {
        painter.paint(buildContext(recording, { settled: [buildLevel()], selectedId: 'level' }));

        expect(recording.callsTo('arc')).toHaveLength(1);
    });

    it('grips nothing while nothing is selected', () => {
        painter.paint(buildContext(recording, { settled: [buildLevel()] }));

        expect(recording.callsTo('arc')).toEqual([]);
    });
});

describe('DrawingPainter drawing a segment', () => {
    const painter = new DrawingPainter();
    let recording: RecordingContext;

    beforeEach(() => { recording = createRecordingContext(); });

    it('draws it between the two points that set it', () => {
        const paint = buildContext(recording, { settled: [buildTrend()] });

        painter.paint(paint);

        expect(recording.callsTo('lineTo')[0]?.args)
            .toEqual([paint.layout.plotWidth, paint.projector.priceToY(DEFAULT_VIEWPORT.highPrice)]);
    });

    it('grips both of them when it is selected', () => {
        painter.paint(buildContext(recording, { settled: [buildTrend()], selectedId: 'trend' }));

        expect(recording.callsTo('arc')).toHaveLength(2);
    });

    it('dashes one still being dragged out, so it does not read as settled', () => {
        painter.paint(buildContext(recording, { draft: buildTrend() }));

        const dashes = recording.callsTo('setLineDash').map((call) => call.args[0]);
        expect(dashes.some((dash) => Array.isArray(dash) && dash.length > 0)).toBe(true);
    });

    it('draws a settled mark solid', () => {
        painter.paint(buildContext(recording, { settled: [buildTrend()] }));

        expect(recording.callsTo('setLineDash').map((call) => call.args[0])).toEqual([[]]);
    });
});

describe('DrawingPainter drawing a zone', () => {
    const painter = new DrawingPainter();
    let recording: RecordingContext;

    function buildZone(overrides: Partial<Drawing> = {}): Drawing {
        return { ...buildTrend(), id: 'zone', kind: 'zone', ...overrides };
    }

    beforeEach(() => { recording = createRecordingContext(); });

    it('tints the ground it covers, so what is under it still reads', () => {
        painter.paint(buildContext(recording, { settled: [buildZone()] }));

        expect(recording.callsTo('fillRect')).toHaveLength(1);
    });

    it('outlines it as well, so its edges are where a reader put them', () => {
        painter.paint(buildContext(recording, { settled: [buildZone()] }));

        expect(recording.callsTo('strokeRect')).toHaveLength(1);
    });

    it('boxes it the same way round however it was dragged out', () => {
        const forwards = buildContext(recording, { settled: [buildZone()] });
        painter.paint(forwards);
        const drawn = recording.callsTo('strokeRect')[0]?.args;

        const backwards = createRecordingContext();
        painter.paint(buildContext(backwards, {
            settled: [buildZone({ anchors: [...buildTrend().anchors].reverse() })],
        }));

        expect(backwards.callsTo('strokeRect')[0]?.args).toEqual(drawn);
    });

    it('grips both corners when it is selected', () => {
        painter.paint(buildContext(recording, { settled: [buildZone()], selectedId: 'zone' }));

        expect(recording.callsTo('arc')).toHaveLength(2);
    });
});

describe('DrawingPainter honouring how a mark says to draw it', () => {
    const painter = new DrawingPainter();
    let recording: RecordingContext;

    beforeEach(() => { recording = createRecordingContext(); });

    it('draws a heavy mark heavier than a light one', () => {
        painter.paint(buildContext(recording, { settled: [buildLevel({ width: 'thin' })] }));
        const thin = recording.callsTo('stroke')[0]?.lineWidth ?? 0;

        painter.paint(buildContext(recording, { settled: [buildLevel({ width: 'thick' })] }));

        expect(recording.callsTo('stroke')[1]?.lineWidth).toBeGreaterThan(thin);
    });

    it('draws the mark being worked on heavier than it asked for, so it reads as picked', () => {
        painter.paint(buildContext(recording, { settled: [buildLevel({ width: 'thin' })], selectedId: 'level' }));

        expect(recording.callsTo('stroke')[0]?.lineWidth).toBeGreaterThan(1);
    });

    it('breaks up a dashed mark', () => {
        painter.paint(buildContext(recording, { settled: [buildLevel({ style: 'dashed' })] }));

        expect(recording.callsTo('setLineDash')[0]?.args[0]).not.toEqual([]);
    });

    it('draws a solid mark unbroken', () => {
        painter.paint(buildContext(recording, { settled: [buildLevel({ style: 'solid' })] }));

        expect(recording.callsTo('setLineDash')[0]?.args[0]).toEqual([]);
    });

    it('rounds the ends of a dotted mark, so its dots are dots', () => {
        // Square ends turn a one-pixel dash into a dash again, which is the
        // line a reader picked dotted to avoid.
        painter.paint(buildContext(recording, { settled: [buildLevel({ style: 'dotted' })] }));

        expect(recording.callsTo('stroke')[0]?.lineCap).toBe('round');
    });

    it('leaves a dashed mark square-ended, so its dashes keep their length', () => {
        painter.paint(buildContext(recording, { settled: [buildLevel({ style: 'dashed' })] }));

        expect(recording.callsTo('stroke')[0]?.lineCap).toBe('butt');
    });

    it('draws a mark still being dragged out as provisional, whatever line it will settle to', () => {
        painter.paint(buildContext(recording, { draft: buildTrend({ style: 'solid' }) }));

        expect(recording.callsTo('setLineDash')[0]?.args[0]).not.toEqual([]);
    });
});

describe('DrawingPainter taking a measurement', () => {
    const painter = new DrawingPainter();
    let recording: RecordingContext;

    function buildMeasure(toPrice: number): Drawing {
        return {
            id: 'measure',
            kind: 'measure',
            instrumentSymbol: 'BTCUSDT',
            anchors: [
                { atMs: DEFAULT_VIEWPORT.fromMs, price: DEFAULT_VIEWPORT.lowPrice },
                { atMs: MID_MS, price: toPrice },
            ],
            tone: 'violet',
        };
    }

    beforeEach(() => { recording = createRecordingContext(); });

    it('writes what it came to, in money and in proportion', () => {
        painter.paint(buildContext(recording, { draft: buildMeasure(DEFAULT_VIEWPORT.highPrice) }));

        const written = recording.callsTo('fillText').map((call) => String(call.args[0]));
        expect(written.some((line) => line.includes('%'))).toBe(true);
    });

    it('says how long the move took as well as how far it went', () => {
        painter.paint(buildContext(recording, { draft: buildMeasure(DEFAULT_VIEWPORT.highPrice) }));

        expect(recording.callsTo('fillText')).toHaveLength(2);
    });

    it('reads a rise in the colour a rise is drawn in', () => {
        painter.paint(buildContext(recording, { draft: buildMeasure(DEFAULT_VIEWPORT.highPrice) }));

        expect(recording.callsTo('fillRect')[0]?.fillStyle).toBe(RENDER_PALETTE.bid);
    });

    it('reads a fall in the colour a fall is drawn in', () => {
        // Which way price went is the answer, so the mark's own tone would be
        // one more colour on the chart saying nothing.
        const falling = buildMeasure(DEFAULT_VIEWPORT.lowPrice - 10);

        painter.paint(buildContext(recording, { draft: falling }));

        expect(recording.callsTo('fillRect')[0]?.fillStyle).toBe(RENDER_PALETTE.ask);
    });

    it('draws the arrow it is read along', () => {
        painter.paint(buildContext(recording, { draft: buildMeasure(DEFAULT_VIEWPORT.highPrice) }));

        expect(recording.callsTo('stroke').length).toBeGreaterThan(0);
    });
});

describe('DrawingPainter ruling retracements', () => {
    const painter = new DrawingPainter();
    let recording: RecordingContext;

    function buildRetracement(): Drawing {
        return {
            id: 'fib',
            kind: 'fibonacci',
            instrumentSymbol: 'BTCUSDT',
            anchors: [
                { atMs: DEFAULT_VIEWPORT.fromMs, price: DEFAULT_VIEWPORT.lowPrice },
                { atMs: MID_MS, price: DEFAULT_VIEWPORT.highPrice },
            ],
            tone: 'violet',
        };
    }

    beforeEach(() => { recording = createRecordingContext(); });

    it('rules one line per level a reader watches', () => {
        painter.paint(buildContext(recording, { settled: [buildRetracement()] }));

        expect(recording.callsTo('stroke')).toHaveLength(FIBONACCI_RATIOS.length);
    });

    it('names each line by the proportion of the move it stands at', () => {
        painter.paint(buildContext(recording, { settled: [buildRetracement()] }));

        const written = recording.callsTo('fillText').map((call) => String(call.args[0]));
        expect(written).toContain('61.8%');
    });

    it('writes a whole percentage without a decimal nobody reads', () => {
        painter.paint(buildContext(recording, { settled: [buildRetracement()] }));

        const written = recording.callsTo('fillText').map((call) => String(call.args[0]));
        expect(written).toContain('50%');
    });

    it('carries the lines across the window, not only over the move', () => {
        // A retracement is a price to watch, and price arrives to the right of
        // where the move was drawn.
        const paint = buildContext(recording, { settled: [buildRetracement()] });
        painter.paint(paint);

        const ends = recording.callsTo('lineTo').map((call) => call.args[0]);
        expect(ends.every((x) => x === paint.layout.plotWidth)).toBe(true);
    });

    it('draws the ends of the move solid and the levels between them broken', () => {
        painter.paint(buildContext(recording, { settled: [buildRetracement()] }));

        const dashes = recording.callsTo('setLineDash').map((call) => call.args[0]);
        expect([dashes.filter((dash) => Array.isArray(dash) && dash.length === 0).length >= 2, dashes.length])
            .toEqual([true, FIBONACCI_RATIOS.length + 1]);
    });
});

describe('describeDrawings', () => {
    it('answers the same for the same marks', () => {
        const view = { ...EMPTY_DRAWINGS_VIEW, settled: [buildLevel()] };

        expect(describeDrawings(view)).toBe(describeDrawings({ ...view, settled: [buildLevel()] }));
    });

    it('changes when a mark moves', () => {
        // The chart holds the layer it drew between frames; a mark that moved
        // without changing this would be drawn where it used to be until
        // something else happened to move.
        const before = describeDrawings({ ...EMPTY_DRAWINGS_VIEW, settled: [buildLevel()] });
        const moved = buildLevel({ anchors: [{ atMs: MID_MS, price: MID_PRICE + 1 }] });

        expect(describeDrawings({ ...EMPTY_DRAWINGS_VIEW, settled: [moved] })).not.toBe(before);
    });

    it('changes when a mark is selected', () => {
        const view = { ...EMPTY_DRAWINGS_VIEW, settled: [buildLevel()] };

        expect(describeDrawings({ ...view, selectedId: 'level' })).not.toBe(describeDrawings(view));
    });

    it('changes while a mark is being dragged out', () => {
        expect(describeDrawings({ ...EMPTY_DRAWINGS_VIEW, draft: buildTrend() }))
            .not.toBe(describeDrawings(EMPTY_DRAWINGS_VIEW));
    });

    it('changes when a mark is recoloured', () => {
        const view = { ...EMPTY_DRAWINGS_VIEW, settled: [buildLevel()] };

        expect(describeDrawings({ ...view, settled: [buildLevel({ tone: 'cyan' })] }))
            .not.toBe(describeDrawings(view));
    });

});

describe('describeDrawings reading the look', () => {
    it('changes when a mark is given a different weight', () => {
        // The held layer is redrawn from this alone: a weight that changed
        // without changing it would not be drawn until something else moved.
        const view = { ...EMPTY_DRAWINGS_VIEW, settled: [buildLevel()] };

        expect(describeDrawings({ ...view, settled: [buildLevel({ width: 'thick' })] }))
            .not.toBe(describeDrawings(view));
    });

    it('changes when a mark is given a different line', () => {
        const view = { ...EMPTY_DRAWINGS_VIEW, settled: [buildLevel()] };

        expect(describeDrawings({ ...view, settled: [buildLevel({ style: 'dotted' })] }))
            .not.toBe(describeDrawings(view));
    });
});

describe('DrawingPainter writing what a mark is called', () => {
    const painter = new DrawingPainter();
    let recording: RecordingContext;

    beforeEach(() => { recording = createRecordingContext(); });

    /** Every name the painter wrote on the chart. */
    function namesWritten(): string[] {
        return recording.callsTo('fillText').map((call) => String(call.args[0]));
    }

    it('writes the name a reader gave the mark', () => {
        const level = buildLevel({ label: 'support' });

        painter.paint(buildContext(recording, { settled: [level] }));

        expect(namesWritten()).toContain('support');
    });

    it('writes nothing beside a mark that was never named', () => {
        painter.paint(buildContext(recording, { settled: [buildLevel()] }));

        expect(namesWritten()).toEqual([]);
    });

    it('turns the name to lie along a rising line', () => {
        const trend = buildTrend({ label: 'breakout' });

        painter.paint(buildContext(recording, { settled: [trend] }));

        expect(recording.callsTo('rotate')[0]?.args[0]).not.toBe(0);
    });

    it('leaves the name level on a mark that is level', () => {
        const level = buildLevel({ label: 'support' });

        painter.paint(buildContext(recording, { settled: [level] }));

        expect(recording.callsTo('rotate')[0]?.args[0]).toBe(0);
    });

    it('keeps the name the right way up on a line drawn leftward', () => {
        const backward = buildTrend({
            label: 'breakout',
            anchors: [
                { atMs: DEFAULT_VIEWPORT.toMs, price: DEFAULT_VIEWPORT.lowPrice },
                { atMs: DEFAULT_VIEWPORT.fromMs, price: DEFAULT_VIEWPORT.highPrice },
            ],
        });

        painter.paint(buildContext(recording, { settled: [backward] }));

        expect(Math.abs(Number(recording.callsTo('rotate')[0]?.args[0]))).toBeLessThanOrEqual(Math.PI / 2);
    });

    it('draws the mark again when only its name changed', () => {
        const before = describeDrawings({ ...EMPTY_DRAWINGS_VIEW, settled: [buildLevel()] });

        const after = describeDrawings({
            ...EMPTY_DRAWINGS_VIEW,
            settled: [buildLevel({ label: 'support' })],
        });

        expect(after).not.toBe(before);
    });
});
