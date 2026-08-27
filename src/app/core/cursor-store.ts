import { ObservableStore } from './observable-store.ts';

export interface CursorReadout {
    /** Instant under the pointer, or null when it is off the chart. */
    readonly atMs: number | null;
}

const NO_CURSOR: CursorReadout = { atMs: null };

/**
 * Where the pointer is, kept apart from everything else the chart knows.
 *
 * Its own store because it changes on every mouse move: folded into the chart's
 * state, one pointer move would rerender every part of the interface that reads
 * anything at all, sixty times a second, to move one number.
 */
export function createCursorStore(): ObservableStore<CursorReadout> {
    return new ObservableStore<CursorReadout>({ initialState: NO_CURSOR });
}

/**
 * Publishes a pointer instant, skipping a write that changes nothing.
 *
 * @param store - The store to publish to.
 * @param atMs - The instant under the pointer, or null when it left.
 */
export function publishCursor(
    store: ObservableStore<CursorReadout>,
    atMs: number | null,
): void {
    if (store.read().atMs !== atMs) {
        store.update(() => ({ atMs }));
    }
}
