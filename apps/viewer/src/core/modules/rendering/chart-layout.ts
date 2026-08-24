import { RENDER_METRICS } from './render-palette';
import type { ChartLayout } from './render-types';

/** Below this width the chart is treated as a phone and the chrome shrinks. */
const COMPACT_WIDTH_PX = 560;

export interface ChartLayoutRequest {
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly isVolumeProfileVisible: boolean;
}

export const EMPTY_LAYOUT: ChartLayout = {
    plotWidth: 1,
    plotHeight: 1,
    profileX: 1,
    profileWidth: 0,
    priceAxisX: 1,
    priceAxisWidth: 0,
    isCompact: false,
};

/**
 * Divides the surface into the plot, the profile panel, and the two axes.
 *
 * @param request - Surface size and whether the profile panel is showing.
 * @returns Where each band starts and how wide it is.
 */
export function resolveChartLayout(request: ChartLayoutRequest): ChartLayout {
    const isCompact = request.cssWidth < COMPACT_WIDTH_PX;
    const priceAxisWidth = isCompact
        ? RENDER_METRICS.priceAxisWidthCompact
        : RENDER_METRICS.priceAxisWidth;
    const profileWidth = request.isVolumeProfileVisible
        ? (isCompact ? RENDER_METRICS.profileWidthCompact : RENDER_METRICS.profileWidth)
        : 0;

    const plotWidth = Math.max(1, request.cssWidth - priceAxisWidth - profileWidth);
    return {
        plotWidth,
        plotHeight: Math.max(1, request.cssHeight - RENDER_METRICS.timeAxisHeight),
        profileX: plotWidth,
        profileWidth,
        priceAxisX: plotWidth + profileWidth,
        priceAxisWidth,
        isCompact,
    };
}
