import type { ChartState } from '@core/modules/chart/chart-controller';
import { useKernel } from './kernel-context';
import { useStore } from './use-store';

/**
 * The chart's current state.
 *
 * @returns Everything the chart knows, re-rendering the caller on each change.
 */
export function useChartState(): ChartState {
    return useStore(useKernel().chart.store);
}
