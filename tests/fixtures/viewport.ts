import { observedSize } from './observed-size.ts';
import { vi } from 'vitest';

/**
 * A window, and the cards in it, whose width a test decides.
 *
 * The layouts either side of a breakpoint are different trees rather than the
 * same one hidden and shown, so a test that does not say how wide the window is
 * is a test of whichever tree the host happened to build.
 *
 * @returns Sets the width every later `matchMedia` answer is measured against.
 */
export function stubViewport(): (widthPx: number) => void {
    let widthPx = 1_280;

    vi.stubGlobal('matchMedia', (query: string) => {
        const asked = /min-width:\s*(\d+)px/.exec(query);
        return {
            get matches() { return asked !== null && widthPx >= Number(asked[1]); },
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        } as unknown as MediaQueryList;
    });

    return (wanted: number) => {
        widthPx = wanted;
        // The card is as wide as the screen it was asked about, which is what
        // every test that says a width means: a component that lays itself out
        // by its own box would otherwise keep whatever the last test left.
        observedSize.width = wanted;
    };
}
