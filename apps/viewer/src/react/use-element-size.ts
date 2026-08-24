import { type RefObject, useEffect, useState } from 'react';

export interface ElementSize {
    readonly width: number;
    readonly height: number;
}

/**
 * Tracks an element's rendered size.
 *
 * A canvas has to be told its pixel dimensions, and on a phone those change on
 * every rotation and every time the browser chrome collapses, neither of which
 * fires a window resize.
 *
 * @param elementRef - Ref to the element to observe.
 * @returns The latest content-box size, zero until the first observation.
 */
export function useElementSize(elementRef: RefObject<HTMLElement | null>): ElementSize {
    const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

    useEffect(() => {
        const element = elementRef.current;
        if (element === null) {
            return;
        }

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry !== undefined) {
                setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
            }
        });
        observer.observe(element);

        return () => {
            observer.disconnect();
        };
    }, [elementRef]);

    return size;
}
