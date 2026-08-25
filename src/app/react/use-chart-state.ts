import type { ChartState } from '../core/chart-controller.ts';
import { useKernel } from './kernel-context.ts';
import { useStore } from './use-store.ts';

/**
 * The chart's current state.
 *
 * @returns Everything the chart knows, re-rendering the caller on each change.
 */
export function useChartState(): ChartState {
    return useStore(useKernel().chart.store);
}
