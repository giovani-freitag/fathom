import { vi } from 'vitest';

/**
 * A window whose width a test decides.
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

    return (wanted: number) => { widthPx = wanted; };
}
