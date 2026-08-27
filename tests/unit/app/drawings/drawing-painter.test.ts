import { beforeEach, describe, expect, it } from 'vitest';
import { buildPaintContext, createRecordingContext, type RecordingContext } from '../../../mocks/canvas-context.ts';
import { DEFAULT_VIEWPORT } from '../../../mocks/canvas-context.ts';
import type { Drawing } from '../../../../src/shared/core/drawing.ts';
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
