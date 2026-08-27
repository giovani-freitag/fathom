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

/**
 * Reads one slice of an `ObservableStore` as React state.
 *
 * The caller re-renders only when the slice changes, which is what keeps a
 * viewport rewritten many times a second from rebuilding a menu that never
 * reads it.
 *
 * @param store - The store to follow.
 * @param select - Picks the slice. Must be stable across renders, and must
 *     answer with a value React can compare — a figure, or a reference the
 *     store keeps between changes. A fresh object every call never settles.
 * @returns The current slice.
 */
export function useStoreSlice<TState, TSlice>(
    store: ObservableStore<TState>,
    select: (state: TState) => TSlice,
): TSlice {
    const subscribe = useMemo(() => store.subscribe.bind(store), [store]);
    const readSlice = useMemo(() => () => select(store.read()), [store, select]);

    return useSyncExternalStore(subscribe, readSlice);
}
