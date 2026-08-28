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
