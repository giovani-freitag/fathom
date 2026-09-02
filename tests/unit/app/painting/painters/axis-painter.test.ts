import { AxisPainter } from '../../../../../src/app/painting/painters/axis-painter.ts';
import { describe, expect, it } from 'vitest';
import {
    buildPaintContext,
    createRecordingContext,
    type RecordingContext,
} from '../../../../mocks/canvas-context.ts';

function readLabelPositions(recording: RecordingContext): { text: string; x: number }[] {
    return recording.callsTo('fillText').map((call) => ({
        text: String(call.args[0]),
        x: Number(call.args[1]),
    }));
}

describe('AxisPainter.paintTimeAxis', () => {
    it('never lets a label hang off the left edge', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording);

        new AxisPainter().paintTimeAxis(paint);

        const leftmost = readLabelPositions(recording).map(
            (label) => label.x - label.text.length * 3,
        );
        expect(leftmost.every((edge) => edge >= 0)).toBe(true);
    });

    it('never lets a label hang off the right edge', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording);

        new AxisPainter().paintTimeAxis(paint);

        const rightmost = readLabelPositions(recording).map(
            (label) => label.x + label.text.length * 3,
        );
        expect(rightmost.every((edge) => edge <= paint.layout.plotWidth)).toBe(true);
    });

    it('labels the axis at all', () => {
        const recording = createRecordingContext();

        new AxisPainter().paintTimeAxis(buildPaintContext(recording));

        expect(recording.callsTo('fillText').length).toBeGreaterThan(0);
    });
});

describe('AxisPainter.paintPriceAxis', () => {
    it('keeps every label inside the plot height', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording);

        new AxisPainter().paintPriceAxis(paint);

        const ys = recording.callsTo('fillText').map((call) => Number(call.args[2]));
        expect(ys.every((y) => y >= 0 && y <= paint.layout.pricePaneHeight)).toBe(true);
    });

    it('draws labels inside the axis gutter, not over the plot', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording);

        new AxisPainter().paintPriceAxis(paint);

        const xs = recording.callsTo('fillText').map((call) => Number(call.args[1]));
        expect(xs.every((x) => x >= paint.layout.priceAxisX)).toBe(true);
    });
});

describe('AxisPainter pinned time tag', () => {
    it('pins nothing without a crosshair', () => {
        const recording = createRecordingContext();

        new AxisPainter().paintTimeAxis(buildPaintContext(recording));

        expect(recording.callsTo('fillRect').length).toBe(1);
    });

    it('keeps the tag inside the plot when the cursor is at the far right', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording);
        const pointer = { x: paint.layout.plotWidth, y: 100 };

        new AxisPainter().paintTimeAxis({
            ...paint,
            request: { ...paint.request, pointer },
            crosshairY: pointer.y,
        });

        const tagBox = recording.callsTo('fillRect').at(-1);
        expect(Number(tagBox?.args[0]) + Number(tagBox?.args[2]))
            .toBeLessThanOrEqual(paint.layout.plotWidth);
    });

    it('keeps the tag inside the plot when the cursor is at the far left', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording);
        const pointer = { x: 0, y: 100 };

        new AxisPainter().paintTimeAxis({
            ...paint,
            request: { ...paint.request, pointer },
            crosshairY: pointer.y,
        });

        expect(Number(recording.callsTo('fillRect').at(-1)?.args[0])).toBeGreaterThanOrEqual(0);
    });

    it('drops the axis labels the tag would sit on top of', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording);
        const painter = new AxisPainter();

        painter.paintTimeAxis(paint);
        const withoutTag = recording.callsTo('fillText').length;

        const tagged = createRecordingContext();
        const taggedPaint = buildPaintContext(tagged);
        const pointer = { x: taggedPaint.layout.plotWidth / 2, y: 100 };
        painter.paintTimeAxis({
            ...taggedPaint,
            request: { ...taggedPaint.request, pointer },
            crosshairY: pointer.y,
        });

        expect(tagged.callsTo('fillText').length).toBeLessThanOrEqual(withoutTag);
    });
});

describe('AxisPainter price tag', () => {
    it('pins a price tag inside the price axis gutter', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording);

        new AxisPainter().paintPriceTag(paint, {
            price: 78_500,
            y: 100,
            background: '#fff',
            foreground: '#000',
        });

        expect(Number(recording.callsTo('fillRect')[0]?.args[0])).toBeGreaterThan(paint.layout.plotWidth);
    });
});

describe('AxisPainter labelling a band', () => {
    /** A band, optionally carrying a level at a named value. */
    function buildBandedContext(recording: RecordingContext, cssWidth: number, levelValue = 18_732) {
        return buildPaintContext(recording, {
            cssWidth,
            plans: [{
                indicatorId: 'delta',
                labelKey: 'indicator.delta',
                parameterSummary: '',
                scale: { kind: 'symmetric' },
                series: [{
                    labelKey: 'indicator.delta',
                    tone: 'bid',
                    shape: 'histogram',
                    baseline: 0,
                    atMs: Float64Array.from([1_200_000, 1_400_000]),
                    value: Float64Array.from([18_732, -18_732]),
                }],
                levels: [{ value: levelValue, tone: 'muted' }],
                hasConverged: true,
            }],
        });
    }

    it('writes no two figures on top of each other', () => {
        // A level landing on the band's own reach is written twice, one glyph
        // over the other, and neither can be read.
        const recording = createRecordingContext();

        new AxisPainter().paintPriceAxis(buildBandedContext(recording, 1_600));

        // Two of the same figure overprinted is the commonest form of it, so
        // the text is not part of the test — only how close two of them land.
        const written = recording.callsTo('fillText')
            .map((call) => ({ text: String(call.args[0]), y: Number(call.args[2]) }));
        const crowded = written.filter((one) => written.some((other) => (
            other !== one && Math.abs(other.y - one.y) < 11
        )));
        expect(crowded).toEqual([]);
    });

    it('abbreviates a band figure in a gutter a phone can spare', () => {
        // The price ticks already shorten here. Written out in 46 pixels, a
        // five-figure reading loses its last digit off the edge of the frame.
        const recording = createRecordingContext();

        new AxisPainter().paintPriceAxis(buildBandedContext(recording, 390));

        const written = recording.callsTo('fillText').map((call) => String(call.args[0]));
        expect(written.some((text) => text.includes('18.7K'))).toBe(true);
    });

    it('writes a band figure out in full where there is room for it', () => {
        const recording = createRecordingContext();

        new AxisPainter().paintPriceAxis(buildBandedContext(recording, 1_600));

        const written = recording.callsTo('fillText').map((call) => String(call.args[0]));
        expect(written.some((text) => text.includes('18,732') || text.includes('18732'))).toBe(true);
    });
});
