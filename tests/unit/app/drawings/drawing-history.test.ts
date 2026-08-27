import { describe, expect, it } from 'vitest';
import type { Drawing } from '../../../../src/shared/core/drawing.ts';
import { DrawingHistory, MAXIMUM_HISTORY_STEPS } from '../../../../src/app/drawings/drawing-history.ts';

/** A set of marks, told apart by how many are in it. */
function buildSet(count: number): readonly Drawing[] {
    return Array.from({ length: count }, (unused, index) => ({
        id: `mark-${index}`,
        kind: 'horizontal-line' as const,
        instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 1_000, price: index }],
        tone: 'phosphor' as const,
    }));
}

describe('DrawingHistory', () => {
    it('has nothing to step back to before anything happened', () => {
        expect(new DrawingHistory().canUndo).toBe(false);
    });

    it('has nothing to step forward to either', () => {
        expect(new DrawingHistory().canRedo).toBe(false);
    });

    it('offers a step back once something is recorded', () => {
        const history = new DrawingHistory();

        history.record(buildSet(0));

        expect(history.canUndo).toBe(true);
    });

    it('hands back what was there before', () => {
        const history = new DrawingHistory();
        history.record(buildSet(1));

        expect(history.undo(buildSet(2))).toEqual(buildSet(1));
    });

    it('offers a step forward once one was taken back', () => {
        const history = new DrawingHistory();
        history.record(buildSet(1));
        history.undo(buildSet(2));

        expect(history.canRedo).toBe(true);
    });

    it('hands back what was undone', () => {
        const history = new DrawingHistory();
        history.record(buildSet(1));
        history.undo(buildSet(2));

        expect(history.redo(buildSet(1))).toEqual(buildSet(2));
    });

    it('walks a whole run of steps back in order', () => {
        const history = new DrawingHistory();
        history.record(buildSet(0));
        history.record(buildSet(1));

        expect([history.undo(buildSet(2)), history.undo(buildSet(1))])
            .toEqual([buildSet(1), buildSet(0)]);
    });

    it('steps back to nothing once there is nothing left', () => {
        expect(new DrawingHistory().undo(buildSet(1))).toBeNull();
    });

    it('steps forward to nothing when nothing was undone', () => {
        expect(new DrawingHistory().redo(buildSet(1))).toBeNull();
    });

    it('gives up what was ahead once the reader does something new', () => {
        // A step taken after undoing is a new branch: what was ahead belonged to
        // a chart that no longer exists.
        const history = new DrawingHistory();
        history.record(buildSet(1));
        history.undo(buildSet(2));

        history.record(buildSet(1));

        expect(history.canRedo).toBe(false);
    });

    it('forgets the oldest step once it holds more than it may', () => {
        const history = new DrawingHistory();
        for (let step = 0; step <= MAXIMUM_HISTORY_STEPS; step += 1) {
            history.record(buildSet(step));
        }

        let stepped: readonly Drawing[] | null = null;
        for (let step = 0; step <= MAXIMUM_HISTORY_STEPS; step += 1) {
            stepped = history.undo(buildSet(0)) ?? stepped;
        }

        expect(stepped).toEqual(buildSet(1));
    });
});
