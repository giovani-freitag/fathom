import {
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useState,
} from 'react';

/** Which edge the reader drags, and so which way the panel grows. */
export type GrowsAlong = 'width' | 'height';

export interface PanelSizeRequest {
    /** Where the size is remembered, per browser. */
    readonly slot: string;
    readonly growsAlong: GrowsAlong;
    /** What it opens at, as a fraction of the viewport. */
    readonly openingRatio: number;
    /** How small and how large the reader may make it, as fractions. */
    readonly smallest: number;
    readonly largest: number;
}

export interface PanelSize {
    readonly sizePx: number;
    /** The bounds in pixels, for a grip to announce where it sits between. */
    readonly smallestPx: number;
    readonly largestPx: number;
    /** Put these two on the grip the reader drags. */
    readonly onGripDown: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onGripKey: (event: ReactKeyboardEvent<HTMLElement>) => void;
    readonly isDragging: boolean;
    /** Puts it back to what it opens at. */
    readonly reset: () => void;
}

/** How far one arrow press moves the edge. */
const STEP_PX = 24;

function readViewport(growsAlong: GrowsAlong): number {
    return growsAlong === 'width' ? globalThis.innerWidth : globalThis.innerHeight;
}

function readStored(slot: string): number | null {
    try {
        const held = Number(globalThis.localStorage.getItem(slot));
        return Number.isFinite(held) && held > 0 ? held : null;
    } catch {
        return null;
    }
}

function store(slot: string, sizePx: number): void {
    try {
        globalThis.localStorage.setItem(slot, String(Math.round(sizePx)));
    } catch {
        // A reader with storage refused still gets to resize; what they lose is
        // only the size surviving the page.
    }
}

/**
 * A panel the reader can drag bigger or smaller.
 *
 * Held as pixels rather than as a fraction: a reader sizes a panel against what
 * is in it — the width of a line of code — and a fraction would resize itself
 * every time the window moved. The bounds are fractions, so a size kept from a
 * large screen cannot swallow a small one.
 *
 * @param request - Where to remember it, which way it grows, and its bounds.
 * @returns The size, the grip handlers, and the way back to the default.
 */
export function usePanelSize(request: PanelSizeRequest): PanelSize {
    const { slot, growsAlong, openingRatio, smallest, largest } = request;
    const [alongPx, setAlongPx] = useState(() => readViewport(growsAlong));
    const [isDragging, setIsDragging] = useState(false);

    const clamp = useCallback((wanted: number): number => {
        const along = readViewport(growsAlong);
        return Math.min(along * largest, Math.max(along * smallest, wanted));
    }, [growsAlong, largest, smallest]);

    // Measured at the first render rather than in an effect: a size settled
    // afterwards is a panel the reader watches jump to its own width.
    const [sizePx, setSizePx] = useState(() => clamp(readStored(slot) ?? readViewport(growsAlong) * openingRatio));

    // A panel that turns from a rail into a sheet is being asked for a
    // different size, from a different store, along a different axis. Kept as
    // it was, a narrowed window left a sheet holding a width.
    const [lastSlot, setLastSlot] = useState(slot);
    if (lastSlot !== slot) {
        setLastSlot(slot);
        setAlongPx(readViewport(growsAlong));
        setSizePx(clamp(readStored(slot) ?? readViewport(growsAlong) * openingRatio));
    }

    // Clamped again on a resize, so a size kept from a wide window does not
    // leave a narrow one with no chart at all.
    useEffect(() => {
        const handleResize = (): void => {
            setAlongPx(readViewport(growsAlong));
            setSizePx(clamp);
        };
        globalThis.addEventListener('resize', handleResize);
        return () => { globalThis.removeEventListener('resize', handleResize); };
    }, [clamp, growsAlong]);

    const settle = useCallback((next: number): void => {
        const held = clamp(next);
        setSizePx(held);
        store(slot, held);
    }, [clamp, slot]);

    const onGripDown = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
        event.preventDefault();
        const grip = event.currentTarget;
        grip.setPointerCapture(event.pointerId);
        setIsDragging(true);

        const handleMove = (moved: PointerEvent): void => {
            // Measured from the far edge, which is where the panel is anchored:
            // the right of the window for a rail, the bottom for a sheet.
            const next = growsAlong === 'width'
                ? globalThis.innerWidth - moved.clientX
                : globalThis.innerHeight - moved.clientY;
            setSizePx(clamp(next));
        };
        const handleUp = (): void => {
            grip.removeEventListener('pointermove', handleMove);
            grip.removeEventListener('pointerup', handleUp);
            grip.removeEventListener('pointercancel', handleUp);
            setIsDragging(false);
            setSizePx((held) => {
                store(slot, held);
                return held;
            });
        };

        grip.addEventListener('pointermove', handleMove);
        grip.addEventListener('pointerup', handleUp);
        grip.addEventListener('pointercancel', handleUp);
    }, [clamp, growsAlong, slot]);

    const onGripKey = useCallback((event: ReactKeyboardEvent<HTMLElement>): void => {
        // Growing means dragging the near edge away from the far one, so the
        // arrow that grows a right-hand rail is the opposite of the one that
        // grows a bottom sheet.
        const grows = growsAlong === 'width' ? 'ArrowLeft' : 'ArrowUp';
        const shrinks = growsAlong === 'width' ? 'ArrowRight' : 'ArrowDown';
        const along = readViewport(growsAlong);

        const wanted = {
            [grows]: sizePx + STEP_PX,
            [shrinks]: sizePx - STEP_PX,
            Home: along * smallest,
            End: along * largest,
        }[event.key];

        if (wanted !== undefined) {
            event.preventDefault();
            settle(wanted);
        }
    }, [growsAlong, largest, settle, sizePx, smallest]);

    const reset = useCallback((): void => {
        settle(readViewport(growsAlong) * openingRatio);
    }, [growsAlong, openingRatio, settle]);

    return {
        sizePx,
        smallestPx: alongPx * smallest,
        largestPx: alongPx * largest,
        onGripDown,
        onGripKey,
        isDragging,
        reset,
    };
}
