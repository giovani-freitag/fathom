import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { type PanelSizeRequest, usePanelSize } from '../../../../src/app/react/use-panel-size.ts';

const RAIL: PanelSizeRequest = {
    slot: 'test.rail',
    growsAlong: 'width',
    openingRatio: 0.5,
    smallest: 0.25,
    largest: 0.75,
};

const SHEET: PanelSizeRequest = { ...RAIL, slot: 'test.sheet', growsAlong: 'height' };

function pressOnGrip(press: (event: ReactKeyboardEvent<HTMLElement>) => void, key: string): void {
    act(() => {
        press({ key, preventDefault: () => { /* jsdom needs nothing undone */ } } as ReactKeyboardEvent<HTMLElement>);
    });
}

function resizeWindowTo(widthPx: number): void {
    act(() => {
        globalThis.innerWidth = widthPx;
        globalThis.dispatchEvent(new Event('resize'));
    });
}

beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.innerWidth = 1_000;
    globalThis.innerHeight = 800;
});

describe('a panel the reader sizes', () => {
    it('opens at its share of the screen', () => {
        const { result } = renderHook(() => usePanelSize(RAIL));

        expect(result.current.sizePx).toBe(500);
    });

    it('measures a sheet against the height, not the width', () => {
        const { result } = renderHook(() => usePanelSize(SHEET));

        expect(result.current.sizePx).toBe(400);
    });

    it('opens at the size it was left at', () => {
        globalThis.localStorage.setItem('test.rail', '320');

        const { result } = renderHook(() => usePanelSize(RAIL));

        expect(result.current.sizePx).toBe(320);
    });

    it('pulls a size kept from a wider screen back inside the bounds', () => {
        globalThis.localStorage.setItem('test.rail', '4000');

        const { result } = renderHook(() => usePanelSize(RAIL));

        expect(result.current.sizePx).toBe(750);
    });

    it('takes the shape it is asked for when a rail becomes a sheet', () => {
        // A window narrowed past the breakpoint hands the same panel a
        // different slot, a different axis and different bounds. Kept as it
        // was, the sheet opened holding the width of somebody's monitor.
        globalThis.localStorage.setItem('test.rail', '700');
        const { result, rerender } = renderHook(
            (request: PanelSizeRequest) => usePanelSize(request),
            { initialProps: RAIL },
        );

        rerender(SHEET);

        expect(result.current.sizePx).toBe(400);
        expect(result.current.largestPx).toBe(600);
    });

    it('keeps the chart visible when the window shrinks under it', () => {
        const { result } = renderHook(() => usePanelSize(RAIL));

        resizeWindowTo(400);

        expect(result.current.sizePx).toBe(300);
    });
});

describe('sizing a panel from the keyboard', () => {
    it('grows a right-hand rail with the arrow that points away from it', () => {
        const { result } = renderHook(() => usePanelSize(RAIL));

        pressOnGrip(result.current.onGripKey, 'ArrowLeft');

        expect(result.current.sizePx).toBe(524);
    });

    it('shrinks it with the arrow that points back at it', () => {
        const { result } = renderHook(() => usePanelSize(RAIL));

        pressOnGrip(result.current.onGripKey, 'ArrowRight');

        expect(result.current.sizePx).toBe(476);
    });

    it('grows a sheet upwards, the way it came in', () => {
        const { result } = renderHook(() => usePanelSize(SHEET));

        pressOnGrip(result.current.onGripKey, 'ArrowUp');

        expect(result.current.sizePx).toBe(424);
    });

    it('goes straight to the bounds on Home and End', () => {
        const { result } = renderHook(() => usePanelSize(RAIL));

        pressOnGrip(result.current.onGripKey, 'End');

        expect(result.current.sizePx).toBe(750);

        pressOnGrip(result.current.onGripKey, 'Home');

        expect(result.current.sizePx).toBe(250);
    });

    it('puts it back on Enter, because the label promises it can be put back', () => {
        // Reset was a double-press and nothing else, on a control whose own
        // label told a reader on a keyboard to double-press it.
        globalThis.localStorage.setItem('test.rail', '300');
        const { result } = renderHook(() => usePanelSize(RAIL));

        pressOnGrip(result.current.onGripKey, 'Enter');

        expect(result.current.sizePx).toBe(500);
    });

    it('says how much of the screen it takes, not only how many pixels', () => {
        const { result } = renderHook(() => usePanelSize(RAIL));

        pressOnGrip(result.current.onGripKey, 'End');

        expect(result.current.sharePercent).toBe(75);
    });

    it('leaves a key that is not about sizing to whatever else wants it', () => {
        const { result } = renderHook(() => usePanelSize(RAIL));

        pressOnGrip(result.current.onGripKey, 'Enter');

        expect(result.current.sizePx).toBe(500);
    });

    it('remembers what the keyboard settled on', () => {
        const { result } = renderHook(() => usePanelSize(RAIL));

        pressOnGrip(result.current.onGripKey, 'ArrowLeft');

        expect(globalThis.localStorage.getItem('test.rail')).toBe('524');
    });
});

describe('putting a panel back', () => {
    it('returns it to what it opens at, and keeps it there', () => {
        globalThis.localStorage.setItem('test.rail', '300');
        const { result } = renderHook(() => usePanelSize(RAIL));

        act(() => { result.current.reset(); });

        expect(result.current.sizePx).toBe(500);
        expect(globalThis.localStorage.getItem('test.rail')).toBe('500');
    });
});
