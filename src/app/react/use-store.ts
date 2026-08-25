import type { ObservableStore } from '../core/observable-store.ts';
import { useMemo, useSyncExternalStore } from 'react';

/**
 * Reads an `ObservableStore` as React state.
 *
 * @param store - The store to follow.
 * @returns The current state, re-rendering the caller on every change.
 */
export function useStore<TState>(store: ObservableStore<TState>): TState {
    // Memoised because `useSyncExternalStore` resubscribes whenever the
    // subscribe reference changes, which a fresh closure does on every render.
    const subscribe = useMemo(() => store.subscribe.bind(store), [store]);
    const readSnapshot = useMemo(() => store.read.bind(store), [store]);

    return useSyncExternalStore(subscribe, readSnapshot);
}
