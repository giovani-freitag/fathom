import type { ObservableStore } from '../observable-store.ts';
import { useMemo, useSyncExternalStore } from 'react';

/**
 * Reads an `ObservableStore` as React state.
 *
 * The whole bridge between the framework-free core and the view. The bound
 * references are memoised because `useSyncExternalStore` re-subscribes whenever
 * they change.
 *
 * @param store - The store to follow.
 * @returns The current state, re-rendering the caller on every change.
 */
export function useStore<TState>(store: ObservableStore<TState>): TState {
    const subscribe = useMemo(() => store.subscribe.bind(store), [store]);
    const readSnapshot = useMemo(() => store.read.bind(store), [store]);

    return useSyncExternalStore(subscribe, readSnapshot);
}
