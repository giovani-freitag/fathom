import { RENDER_METRICS } from './render-palette.ts';
import type { ChartLayout } from './render-types.ts';

/** Below this width the chart is treated as a phone and the chrome shrinks. */
const COMPACT_WIDTH_PX = 560;

/** Share of the surface one indicator pane takes. */
const INDICATOR_PANE_RATIO = 0.22;

/** The price pane never shrinks below this share, however many panes are added. */
const MINIMUM_PRICE_PANE_RATIO = 0.4;

export interface ChartLayoutRequest {
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly isVolumeProfileVisible: boolean;
    /** Panes below the price pane, one per indicator that needs its own scale. */
    readonly indicatorPaneCount?: number;
}

export const EMPTY_LAYOUT: ChartLayout = {
    plotWidth: 1,
    pricePaneHeight: 1,
    paneStackHeight: 1,
    indicatorPanes: [],
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
    const paneStackHeight = Math.max(1, request.cssHeight - RENDER_METRICS.timeAxisHeight);
    const paneCount = Math.max(0, Math.floor(request.indicatorPaneCount ?? 0));

    // Each pane takes a share, and the price pane keeps a floor: stacking
    // indicators until the thing they describe is a sliver helps nobody.
    const shared = Math.min(paneCount * INDICATOR_PANE_RATIO, 1 - MINIMUM_PRICE_PANE_RATIO);
    const paneHeight = paneCount === 0 ? 0 : (paneStackHeight * shared) / paneCount;
    const pricePaneHeight = Math.max(1, paneStackHeight - paneHeight * paneCount);

    return {
        plotWidth,
        pricePaneHeight,
        paneStackHeight,
        indicatorPanes: Array.from({ length: paneCount }, (_, index) => ({
            topY: pricePaneHeight + paneHeight * index,
            height: paneHeight,
        })),
        profileX: plotWidth,
        profileWidth,
        priceAxisX: plotWidth + profileWidth,
        priceAxisWidth,
        isCompact,
    };
}
