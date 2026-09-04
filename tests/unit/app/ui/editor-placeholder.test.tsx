import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorPlaceholder } from '../../../../src/app/ui/editor-placeholder.tsx';
import { EDITOR_SHELL_CLASSES } from '../../../../src/app/ui/editor-shell.ts';

let shownWidthPx = 390;

/**
 * A viewport of a given width.
 *
 * The width is read through a getter rather than baked into the object: the
 * hook keeps one query list per breakpoint so every caller shares its listener,
 * so a test that handed it a fresh object would be answered from the first one
 * it ever saw. A real query list updates its own `matches`, and so does this.
 */
function viewportOf(widthPx: number): void {
    shownWidthPx = widthPx;
    globalThis.innerWidth = widthPx;
    globalThis.innerHeight = 900;
}

vi.stubGlobal('matchMedia', (query: string) => {
    const asked = /min-width:\s*(\d+)px/.exec(query);
    return {
        get matches() { return asked !== null && shownWidthPx >= Number(asked[1]); },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
});

beforeEach(() => { globalThis.localStorage.clear(); });
afterEach(() => { viewportOf(390); });

describe('what stands where the editor will be while it downloads', () => {
    it('grows along the height on a phone, as the sheet it stands in for does', () => {
        // A rail whatever the width was a phone opening a strip down its side,
        // holding it for as long as the compiler takes to arrive, then throwing
        // it away for a sheet from the bottom.
        viewportOf(390);

        const { container } = render(<EditorPlaceholder />);

        const shell = container.querySelector('aside')!;
        expect(shell.style.height).not.toBe('');
        expect(shell.style.width).toBe('');
    });

    it('grows along the width on a desk, as the rail it stands in for does', () => {
        viewportOf(1440);

        const { container } = render(<EditorPlaceholder />);

        const shell = container.querySelector('aside')!;
        expect(shell.style.width).not.toBe('');
        expect(shell.style.height).toBe('');
    });

    it('wears the shape the panel itself wears', () => {
        // Shared rather than written twice: the two drifting apart is the whole
        // reason the placeholder was a different shape in the first place.
        viewportOf(390);

        const { container } = render(<EditorPlaceholder />);

        expect(container.querySelector('aside')!.className).toBe(EDITOR_SHELL_CLASSES);
    });

    it('says nothing to a screen reader, being a placeholder', () => {
        viewportOf(390);

        const { container } = render(<EditorPlaceholder />);

        expect(container.querySelector('aside')!.getAttribute('aria-hidden')).toBe('true');
    });
});
