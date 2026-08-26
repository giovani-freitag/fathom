import { describe, expect, it, vi } from 'vitest';
import { createCursorStore, publishCursor } from '../../../../src/app/core/cursor-store.ts';

describe('publishCursor', () => {
    it('says nothing when the pointer has not moved to a new instant', () => {
        // Published on every mouse move. A write that changes nothing would
        // still wake every reading on screen, sixty times a second.
        const store = createCursorStore();
        const listener = vi.fn();
        store.subscribe(listener);

        publishCursor(store, 1_000);
        publishCursor(store, 1_000);

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('reports the pointer leaving as leaving, not as staying', () => {
        const store = createCursorStore();
        publishCursor(store, 1_000);

        publishCursor(store, null);

        expect(store.read().atMs).toBeNull();
    });

    it('starts with no pointer on the chart', () => {
        expect(createCursorStore().read().atMs).toBeNull();
    });
});
