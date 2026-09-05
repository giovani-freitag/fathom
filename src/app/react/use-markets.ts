import { useKernel } from './kernel-context.ts';
import { useStore } from './use-store.ts';
import type { MarketsController, MarketsState } from '../core/markets-controller.ts';

/**
 * The pairs a reader keeps and the venues they come from.
 *
 * @returns The state, re-rendering the caller on each change, and the controller.
 */
export function useMarkets(): { readonly state: MarketsState; readonly markets: MarketsController } {
    const markets = useKernel().markets;
    return { state: useStore(markets.store), markets };
}
