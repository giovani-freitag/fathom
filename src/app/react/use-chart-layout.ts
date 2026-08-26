import type { RefObject } from 'react';
import { useMemo } from 'react';
import type { ChartLayout } from '../painting/render-types.ts';
import { EMPTY_LAYOUT, resolveChartLayout } from '../painting/chart-layout.ts';
import { countPanedPlans } from '../painting/pane-projector.ts';
import { useChartState } from './use-chart-state.ts';
import { useElementSize } from './use-element-size.ts';

/**
 * The layout the canvas is drawn with, for the elements placed over it.
 *
 * Recomputed from the same pure function the renderer calls rather than read
 * back from it: two readers of one function cannot disagree, where a value
 * published from inside a paint would arrive a frame late and loop.
 *
 * @param elementRef - An element the size of the chart surface.
 * @returns The layout, or an empty one until the element has been measured.
 */
export function useChartLayout(elementRef: RefObject<HTMLElement | null>): ChartLayout {
    const size = useElementSize(elementRef);
    const state = useChartState();

    return useMemo(() => {
        if (size.width === 0 || size.height === 0) {
            return EMPTY_LAYOUT;
        }
        return resolveChartLayout({
            cssWidth: size.width,
            cssHeight: size.height,
            isVolumeProfileVisible: state.isVolumeProfileVisible,
            indicatorPaneCount: countPanedPlans(state.plans),
        });
    }, [size, state.isVolumeProfileVisible, state.plans]);
}
