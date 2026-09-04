import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsViewportAtLeast } from '../../../../src/app/react/use-viewport-width.ts';

let shownWidthPx = 390;
let listeners: (() => void)[] = [];

beforeEach(() => {
    shownWidthPx = 390;
    listeners = [];
    vi.stubGlobal('matchMedia', (query: string) => {
        const asked = /min-width:\s*(\d+)px/.exec(query);
        return {
            get matches() { return asked !== null && shownWidthPx >= Number(asked[1]); },
            addEventListener: (_: string, listener: () => void) => { listeners.push(listener); },
            removeEventListener: () => undefined,
        } as unknown as MediaQueryList;
    });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('whether the viewport has the room a breakpoint asks for', () => {
    it('answers for the width it is asked about', () => {
        shownWidthPx = 1440;

        const { result } = renderHook(() => useIsViewportAtLeast('lg'));

        expect(result.current).toBe(true);
    });

    it('follows the query when the window changes', () => {
        const { result } = renderHook(() => useIsViewportAtLeast('lg'));

        act(() => {
            shownWidthPx = 1440;
            listeners.forEach((listen) => { listen(); });
        });

        expect(result.current).toBe(true);
    });
});
