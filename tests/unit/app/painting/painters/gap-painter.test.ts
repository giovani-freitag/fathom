import { GapPainter } from '../../../../../src/app/painting/painters/gap-painter.ts';
import { describe, expect, it } from 'vitest';
import { buildPaintContext, createRecordingContext } from '../../../../mocks/canvas-context.ts';

function buildGap(gapStartedAtMs: number, gapEndedAtMs: number) {
    return { gapStartedAtMs, gapEndedAtMs, gapReason: 'collector was not running' };
}

describe('GapPainter', () => {
    it('draws nothing when the window has no gaps', () => {
        const recording = createRecordingContext();

        new GapPainter().paint(buildPaintContext(recording));

        expect(recording.callsTo('fillRect')).toEqual([]);
    });

    it('fills a band for a gap inside the range', () => {
        const recording = createRecordingContext();

        new GapPainter().paint(buildPaintContext(recording, {
            dataset: { gaps: [buildGap(1_200_000, 1_400_000)] },
        }));

        expect(recording.callsTo('fillRect').length).toBe(1);
    });

    it('spans every pane, because a gap is a stretch of time and not of price', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { gaps: [buildGap(1_200_000, 1_400_000)] },
        });

        new GapPainter().paint(paint);

        expect(recording.callsTo('fillRect')[0]?.args[3]).toBe(paint.layout.paneStackHeight);
    });

    it('skips a gap that ended before the visible range', () => {
        const recording = createRecordingContext();

        new GapPainter().paint(buildPaintContext(recording, {
            dataset: { gaps: [buildGap(1, 2)] },
        }));

        expect(recording.callsTo('fillRect')).toEqual([]);
    });

    it('keeps a gap shorter than a pixel visible', () => {
        const recording = createRecordingContext();

        new GapPainter().paint(buildPaintContext(recording, {
            dataset: { gaps: [buildGap(1_500_000, 1_500_001)] },
        }));

        expect(recording.callsTo('fillRect')[0]?.args[2]).toBe(1);
    });

    it('restores a solid line after dashing the gap edges', () => {
        const recording = createRecordingContext();

        new GapPainter().paint(buildPaintContext(recording, {
            dataset: { gaps: [buildGap(1_200_000, 1_400_000)] },
        }));

        expect(recording.callsTo('setLineDash').at(-1)?.args[0]).toEqual([]);
    });
});

describe('GapPainter put down', () => {
    it('marks nothing once the reader has taken the marks off the book', () => {
        // A hole in the book is what a gap is, so the marks belong to the book
        // and go down with it. A reader who has seen where the holes are may
        // want them out of the way.
        const recording = createRecordingContext();

        new GapPainter().paint(buildPaintContext(recording, {
            dataset: { gaps: [buildGap(1_200_000, 1_400_000)] },
            areGapsVisible: false,
        }));

        expect(recording.callsTo('fillRect')).toEqual([]);
    });

    it('marks them while the book still carries them', () => {
        const recording = createRecordingContext();

        new GapPainter().paint(buildPaintContext(recording, {
            dataset: { gaps: [buildGap(1_200_000, 1_400_000)] },
            areGapsVisible: true,
        }));

        expect(recording.callsTo('fillRect').length).toBeGreaterThan(0);
    });
});

describe('GapPainter and how loud a mark about missing data may be', () => {
    /** Every fill the painter laid down, as `[x, y, width, height]`. */
    function fillsOf(recording: ReturnType<typeof createRecordingContext>) {
        return recording.callsTo('fillRect').map((call) => call.args.map(Number));
    }

    it('marks the price pane and not the bands below it', () => {
        // A hole is missing depth. The executions under it were recorded and so
        // was every bar an indicator is built from, so a mark across those
        // bands calls readings suspect that are not.
        //
        // Drawn with a band on the chart, because without one the price pane
        // *is* the stack and the two heights cannot be told apart.
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { gaps: [buildGap(1_200_000, 1_400_000)] },
            plans: [{
                indicatorId: 'cvd',
                labelKey: 'indicator.cvd',
                parameterSummary: '',
                scale: { kind: 'auto' },
                series: [{
                    labelKey: 'indicator.cvd',
                    tone: 'ink',
                    shape: 'line',
                    atMs: Float64Array.from([1_200_000]),
                    value: Float64Array.from([1]),
                }],
                hasConverged: true,
            }],
        });

        expect(paint.layout.pricePaneHeight).toBeLessThan(paint.layout.paneStackHeight);

        new GapPainter().paint(paint);

        expect(fillsOf(recording).map((fill) => fill[3]))
            .toEqual([paint.layout.pricePaneHeight]);
    });

    it('lays one mark over two gaps that touch, not two over each other', () => {
        // Both the fill and the edges are translucent so the book shows
        // through. Stacked, that translucency stops being translucent, and the
        // brightest thing on the chart becomes the absence of data.
        const recording = createRecordingContext();

        new GapPainter().paint(buildPaintContext(recording, {
            dataset: {
                gaps: [buildGap(1_200_000, 1_400_000), buildGap(1_300_000, 1_500_000)],
            },
        }));

        expect(fillsOf(recording).length).toBe(1);
    });

    it('joins them however they arrive, since a ledger is not sorted for it', () => {
        const recording = createRecordingContext();

        new GapPainter().paint(buildPaintContext(recording, {
            dataset: {
                gaps: [buildGap(1_300_000, 1_500_000), buildGap(1_200_000, 1_400_000)],
            },
        }));

        expect(fillsOf(recording).length).toBe(1);
    });

    it('keeps two gaps apart when nothing joins them', () => {
        const recording = createRecordingContext();

        new GapPainter().paint(buildPaintContext(recording, {
            dataset: {
                gaps: [buildGap(1_200_000, 1_250_000), buildGap(1_400_000, 1_450_000)],
            },
        }));

        expect(fillsOf(recording).length).toBe(2);
    });
});
