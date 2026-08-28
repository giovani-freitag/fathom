import { beforeEach, describe, expect, it } from 'vitest';
import { buildPaintContext, createRecordingContext, type RecordingContext } from '../../../../mocks/canvas-context.ts';
import type { GridChoice } from '../../../../../src/app/core/theme.ts';
import { GridPainter } from '../../../../../src/app/painting/painters/grid-painter.ts';

/** How many lines were laid down, whichever way they run. */
function countLines(recording: RecordingContext): { horizontal: number; vertical: number } {
    const moves = recording.callsTo('moveTo');
    const lines = recording.callsTo('lineTo');
    let horizontal = 0;
    let vertical = 0;
    moves.forEach((move, index) => {
        const to = lines[index];
        if (to === undefined) {
            return;
        }
        if (move.args[1] === to.args[1]) {
            horizontal += 1;
        } else {
            vertical += 1;
        }
    });
    return { horizontal, vertical };
}

function paintWith(gridChoice: GridChoice): { horizontal: number; vertical: number } {
    const recording = createRecordingContext();
    new GridPainter().paint(buildPaintContext(recording, { gridChoice }));
    return countLines(recording);
}

describe('GridPainter', () => {
    let recording: RecordingContext;

    beforeEach(() => { recording = createRecordingContext(); });

    it('rules both ways when the reader asks for both', () => {
        const lines = paintWith('both');

        expect([lines.horizontal > 0, lines.vertical > 0]).toEqual([true, true]);
    });

    it('drops the time lines, which run the full height of the stack', () => {
        // One per label, each crossing every pane: they are what a dense
        // liquidity map competes with, and the half a reader drops first.
        const lines = paintWith('price');

        expect([lines.horizontal > 0, lines.vertical]).toEqual([true, 0]);
    });

    it('rules nothing at all when the reader wants the chart bare', () => {
        const lines = paintWith('none');

        expect([lines.horizontal, lines.vertical]).toEqual([0, 0]);
    });

    it('draws nothing at all rather than an empty path', () => {
        new GridPainter().paint(buildPaintContext(recording, { gridChoice: 'none' }));

        expect(recording.callsTo('stroke')).toEqual([]);
    });
});
