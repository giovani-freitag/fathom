import type { ChartState } from '../core/chart-controller.ts';
import { useKernel } from './kernel-context.ts';
import { useStore, useStoreSlice } from './use-store.ts';

/**
 * The chart's current state.
 *
 * @returns Everything the chart knows, re-rendering the caller on each change.
 */
export function useChartState(): ChartState {
    return useStore(useKernel().chart.store);
}

/**
 * One slice of the chart's state.
 *
 * @param select - Picks the slice; must be stable and must answer comparably.
 * @returns The slice, re-rendering the caller only when it changes.
 */
export function useChartSlice<TSlice>(select: (state: ChartState) => TSlice): TSlice {
    return useStoreSlice(useKernel().chart.store, select);
}
