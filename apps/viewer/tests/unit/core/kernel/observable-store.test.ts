import { describe, expect, it, vi } from 'vitest';
import { ObservableStore } from '@core/kernel/observable-store';

describe('ObservableStore', () => {
    it('hands back the same reference until the state changes', () => {
        const store = new ObservableStore({ initialState: { count: 0 } });

        const first = store.read();

        expect(store.read()).toBe(first);
    });

    it('does not call a listener on subscribe', () => {
        const store = new ObservableStore({ initialState: 0 });
        const listener = vi.fn();

        store.subscribe(listener);

        expect(listener).not.toHaveBeenCalled();
    });

    it('publishes the new state to every listener', () => {
        const store = new ObservableStore({ initialState: 0 });
        const listener = vi.fn();
        store.subscribe(listener);

        store.write(1);

        expect(listener).toHaveBeenCalledWith(1);
    });

    it('publishes nothing when the state is identical by reference', () => {
        const state = { count: 0 };
        const store = new ObservableStore({ initialState: state });
        const listener = vi.fn();
        store.subscribe(listener);

        store.write(state);

        expect(listener).not.toHaveBeenCalled();
    });

    it('derives the next state from the current one', () => {
        const store = new ObservableStore({ initialState: { count: 1 } });

        store.update((current) => ({ count: current.count + 1 }));

        expect(store.read()).toEqual({ count: 2 });
    });

    it('stops calling a listener once its canceller runs', () => {
        const store = new ObservableStore({ initialState: 0 });
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);

        unsubscribe();
        store.write(1);

        expect(listener).not.toHaveBeenCalled();
    });

    it('tolerates a canceller being run twice', () => {
        const store = new ObservableStore({ initialState: 0 });
        const unsubscribe = store.subscribe(vi.fn());
        unsubscribe();

        unsubscribe();

        expect(store.listenerCount).toBe(0);
    });
});
