import { useSyncExternalStore } from 'react';

/**
 * Where the interface stops being held in one hand.
 *
 * Tailwind's `lg`, so a class and this hook cannot drift apart about what wide
 * means.
 */
const WIDE_VIEWPORT_QUERY = '(min-width: 1024px)';

// Feature-detected rather than assumed: a test host renders the tree without
// implementing media queries, and the narrow layout is the right answer there.
const wideViewport = typeof globalThis.matchMedia === 'function'
    ? globalThis.matchMedia(WIDE_VIEWPORT_QUERY)
    : null;

/**
 * Subscribes to the one query, so every caller shares the same listener.
 */
function watchWidth(onChange: () => void): () => void {
    wideViewport?.addEventListener('change', onChange);
    return () => { wideViewport?.removeEventListener('change', onChange); };
}

/**
 * Whether there is room for controls to sit out in the open.
 *
 * Read rather than guessed from a class, because the two layouts are not the
 * same controls hidden and shown: a screen held in one hand puts its questions
 * behind one target near the thumb, and a screen that has room asks them out
 * loud along the top. Rendering both and hiding one would mount two of every
 * dialog behind them.
 *
 * @returns True on a viewport wide enough for a bar of its own.
 */
export function useIsWideViewport(): boolean {
    return useSyncExternalStore(
        watchWidth,
        () => wideViewport?.matches ?? false,
        () => false,
    );
}
