import { useSyncExternalStore } from 'react';

/**
 * Where the interface changes shape, named as Tailwind names them.
 *
 * Tailwind's own breakpoints, so a class and this hook cannot drift apart about
 * what wide means.
 */
export type ViewportWidth = 'lg' | 'xl';

const WIDTH_QUERIES: Readonly<Record<ViewportWidth, string>> = {
    lg: '(min-width: 1024px)',
    xl: '(min-width: 1280px)',
};

// Feature-detected rather than assumed: a test host renders the tree without
// implementing media queries, and the narrow layout is the right answer there.
const watchers = new Map<ViewportWidth, MediaQueryList | null>();

/**
 * The one query list per width, so every caller shares the same listener.
 */
function readWatcher(width: ViewportWidth): MediaQueryList | null {
    if (!watchers.has(width)) {
        watchers.set(width, typeof globalThis.matchMedia === 'function'
            ? globalThis.matchMedia(WIDTH_QUERIES[width])
            : null);
    }
    return watchers.get(width) ?? null;
}

/**
 * The one subscribe function per width, held so React does not resubscribe.
 *
 * A fresh closure per render is a listener removed and added on every one of
 * them, which is a resize handler that churns while the reader is resizing.
 */
const subscribers = new Map<ViewportWidth, (onChange: () => void) => () => void>();

/**
 * Subscribes to one width's query, sharing the listener with every caller.
 */
function readSubscriber(width: ViewportWidth): (onChange: () => void) => () => void {
    const held = subscribers.get(width);
    if (held !== undefined) {
        return held;
    }

    const subscribe = (onChange: () => void): (() => void) => {
        const watcher = readWatcher(width);
        watcher?.addEventListener('change', onChange);
        return () => { watcher?.removeEventListener('change', onChange); };
    };
    subscribers.set(width, subscribe);
    return subscribe;
}

/**
 * Whether the viewport has at least the room a breakpoint asks for.
 *
 * Read rather than guessed from a class, because the layouts either side of a
 * breakpoint are not the same controls hidden and shown: a screen held in one
 * hand puts its questions behind one target near the thumb, and a screen that
 * has room asks them out loud along the top. Rendering both and hiding one
 * would mount two of every dialog behind them.
 *
 * @param width - The breakpoint to ask about.
 * @returns True on a viewport at least that wide.
 */
export function useIsViewportAtLeast(width: ViewportWidth): boolean {
    return useSyncExternalStore(
        readSubscriber(width),
        () => readWatcher(width)?.matches ?? false,
        () => false,
    );
}
