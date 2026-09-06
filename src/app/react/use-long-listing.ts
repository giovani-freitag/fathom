import { useEffect, useState } from 'react';

/**
 * How long typing settles before a listing is narrowed by it.
 *
 * Long enough that a word is one narrowing rather than five, short enough that
 * the rows have caught up by the time a reader looks down at them.
 */
export const TYPING_SETTLES_MS = 250;

/**
 * How long to wait for an idle moment before giving up and building anyway.
 *
 * A thread that never goes idle is a thread doing something, and a reader
 * scrolling into rows that were never built is worse than a frame spent
 * building them.
 */
const IDLE_WAITS_MS = 500;

/** What a host with no idle callback waits instead, which is a frame or two. */
const SOON_MS = 120;

/**
 * What was typed, once the typing stopped.
 *
 * The field has to answer the keystroke at once — a letter that takes a third
 * of a second to appear is a keyboard the reader stops trusting — and narrowing
 * a listing does not: it rebuilds a hundred and fifty rows, measured at a
 * hundred and fifty milliseconds a character on a desk and over a second on a
 * phone. So the letter lands now and the rows catch up when the typing pauses.
 *
 * @param typed - What the field is showing, which changes on every keystroke.
 * @returns The same text, lagging by the settling wait.
 */
export function useSettled(typed: string): string {
    const [settled, setSettled] = useState('');

    useEffect(() => {
        const settling = setTimeout(() => { setSettled(typed); }, TYPING_SETTLES_MS);
        return () => { clearTimeout(settling); };
    }, [typed]);

    return settled;
}

/**
 * Whether the whole of a listing may be built yet, or only its first rows.
 *
 * A listing is a hundred and fifty rows and a card shows a dozen: building all
 * of them in the tick the answer arrives spends a third of a second in which
 * nothing the reader does is answered, to draw rows they have not scrolled to.
 *
 * Keyed on the listing itself rather than on a flag, so a new one starts short
 * again without anything having to reset it.
 *
 * @param listing - Whatever the rows are built from, by identity.
 * @returns True once the thread has been free long enough to build them all.
 */
export function useWholeWhenIdle<T>(listing: T): boolean {
    const [whole, setWhole] = useState<T | null>(null);

    useEffect(() => {
        const idle = globalThis.requestIdleCallback;
        if (typeof idle !== 'function') {
            const soon = setTimeout(() => { setWhole(listing); }, SOON_MS);
            return () => { clearTimeout(soon); };
        }
        const asked = idle(() => { setWhole(listing); }, { timeout: IDLE_WAITS_MS });
        return () => { globalThis.cancelIdleCallback(asked); };
    }, [listing]);

    return whole === listing;
}
