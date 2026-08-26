import { useCallback, useSyncExternalStore } from 'react';
import { useKernel } from './kernel-context.ts';

/**
 * The instant under the pointer, or null when it is off the chart.
 *
 * Subscribed to on its own so only what shows a reading under the cursor
 * rerenders when the cursor moves.
 *
 * @returns The instant, or null.
 */
export function useCursorInstant(): number | null {
    const kernel = useKernel();
    const subscribe = useCallback(
        (listener: () => void) => kernel.cursor.subscribe(listener),
        [kernel],
    );
    return useSyncExternalStore(subscribe, () => kernel.cursor.read().atMs);
}
