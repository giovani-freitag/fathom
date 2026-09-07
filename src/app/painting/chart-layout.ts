import { RENDER_METRICS } from './render-palette.ts';
import type { ChartLayout } from './render-types.ts';
import { formatAxisPrice } from '../core/formatting.ts';

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
    /**
     * The prices the axis will have to label, for how wide it has to be.
     *
     * A contract quoted in ten-thousandths of a cent needs eight decimals
     * before one label differs from the one above it, and eight decimals do not
     * fit in an axis sized for a five-figure price. Left fixed, the labels were
     * drawn and then cut off by the frame.
     */
    readonly priceBand?: { readonly lowPrice: number; readonly highPrice: number } | undefined;
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
        : widthForPriceLabels(request.priceBand);
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

/**
 * How many figures the axis draws at once, near enough to size it by.
 *
 * The painter decides the real ticks from the room it has; this only has to be
 * close, because it is answering how many decimals tell one label from another
 * rather than where any of them sit.
 */
const PRICE_LABELS_ABREAST = 8;

/** How wide one figure is in the axis font, which is monospaced. */
const AXIS_FIGURE_PX = 6.6;

/** The room a label needs either side of it. */
const AXIS_LABEL_MARGIN_PX = 12;

/**
 * The axis, as wide as the widest label it has to hold.
 *
 * @param band - The prices on screen, or nothing before there are any.
 * @returns The gutter's width in CSS pixels.
 */
function widthForPriceLabels(band: ChartLayoutRequest['priceBand']): number {
    if (band === undefined) {
        return RENDER_METRICS.priceAxisWidth;
    }

    const spacing = Math.abs(band.highPrice - band.lowPrice) / PRICE_LABELS_ABREAST;
    const figures = Math.max(
        formatAxisPrice(band.lowPrice, spacing).length,
        formatAxisPrice(band.highPrice, spacing).length,
    );
    return Math.max(
        RENDER_METRICS.priceAxisWidth,
        Math.ceil(figures * AXIS_FIGURE_PX) + AXIS_LABEL_MARGIN_PX,
    );
}
