import type { Drawing } from '../../shared/core/drawing.ts';

/** Steps back a reader may take, past which the oldest is forgotten. */
export const MAXIMUM_HISTORY_STEPS = 50;

/**
 * What was on the chart before each thing the reader did.
 *
 * A stack rather than a log of edits: a mark is small and a chart holds few of
 * them, so keeping the whole set per step is cheaper to reason about than
 * inverting a move, a restyle and a removal each on their own terms.
 */
export class DrawingHistory {
    private readonly past: (readonly Drawing[])[] = [];
    private readonly future: (readonly Drawing[])[] = [];

    get canUndo(): boolean {
        return this.past.length > 0;
    }

    get canRedo(): boolean {
        return this.future.length > 0;
    }

    /**
     * Marks the point one step back from what the reader is about to change.
     *
     * @param before - Everything on the chart as it stands.
     */
    record(before: readonly Drawing[]): void {
        this.past.push(before);
        // A new step is a new branch: what was undone is no longer ahead.
        this.future.length = 0;
        if (this.past.length > MAXIMUM_HISTORY_STEPS) {
            this.past.shift();
        }
    }

    /**
     * Steps back one change.
     *
     * @param current - Everything on the chart now, kept to step forward to.
     * @returns What was there before, or null when there is nothing to undo.
     */
    undo(current: readonly Drawing[]): readonly Drawing[] | null {
        const previous = this.past.pop();
        if (previous === undefined) {
            return null;
        }
        this.future.push(current);
        return previous;
    }

    /**
     * Steps forward one change that was undone.
     *
     * @param current - Everything on the chart now, kept to step back to.
     * @returns What was there after it, or null when there is nothing to redo.
     */
    redo(current: readonly Drawing[]): readonly Drawing[] | null {
        const next = this.future.pop();
        if (next === undefined) {
            return null;
        }
        this.past.push(current);
        return next;
    }
}
