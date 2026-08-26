import type { ChartViewport } from '../core/chart-viewport.ts';
import type { PlotLevel } from '../../shared/core/draw-plan.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';
import type { ChartDataset } from '../core/chart-dataset.ts';
import type { ResolvedTheme } from '../core/theme.ts';
import type { DrawPlan } from '../../shared/core/draw-plan.ts';
import type { Locale } from '../i18n/locale.ts';
import type { Translate } from '../i18n/translator.ts';

export interface PointerReadout {
    readonly x: number;
    readonly y: number;
}

/** Everything one paint of the chart depends on. */
export interface RenderRequest {
    readonly viewport: ChartViewport;
    readonly dataset: ChartDataset;
    readonly colourGain: number;
    /** False leaves a plain price chart, with no book behind it. */
    readonly isDepthVisible: boolean;
    readonly isCandleOverlayVisible: boolean;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
    readonly pointer: PointerReadout | null;
    readonly locale: Locale;
    /** What the indicators produced for this window, already computed. */
    readonly plans: readonly DrawPlan[];
    /** Named rather than read from the palette, which is mutated in place. */
    readonly theme: ResolvedTheme;
}

/**
 * Where each band of the surface starts and ends, resolved once per paint.
 */
/** Where one pane sits in the stack, in surface pixels. */
export interface PaneRect {
    readonly topY: number;
    readonly height: number;
}

export interface ChartLayout {
    readonly plotWidth: number;
    /** Where the price pane ends. Depth, candles and executions live above it. */
    readonly pricePaneHeight: number;
    /**
     * Where every pane ends and the time axis begins.
     *
     * Distinct from the price pane because a gap, a grid line and the crosshair
     * belong to time rather than to price, and so cross the whole stack.
     */
    readonly paneStackHeight: number;
    /** Panes below the price pane, top to bottom. */
    readonly indicatorPanes: readonly PaneRect[];
    readonly profileX: number;
    readonly profileWidth: number;
    readonly priceAxisX: number;
    readonly priceAxisWidth: number;
    readonly isCompact: boolean;
}

/**
 * The shared argument every painter takes.
 */
/**
 * One indicator pane, and the range of values it was scaled to.
 *
 * Computed once per frame and read by both the layer that draws inside the pane
 * and the layer that labels the gutter beside it, because a band whose axis
 * disagrees with its own line is worse than one with no axis at all.
 */
export interface PanePlacement {
    readonly rect: PaneRect;
    readonly low: number;
    readonly high: number;
    /** The thresholds drawn in it, so the gutter can name them. */
    readonly levels: readonly PlotLevel[];
}

export interface PaintContext {
    readonly context: CanvasRenderingContext2D;
    readonly layout: ChartLayout;
    readonly projector: ViewportProjector;
    readonly request: RenderRequest;
    /** The crosshair readout is the one place the canvas writes prose. */
    readonly translate: Translate;
    /** Y of the crosshair when one is over the plot, so layers can yield to it. */
    readonly crosshairY: number | null;
    /**
     * The ticks every layer must agree on.
     */
    readonly priceTicks: readonly number[];
    readonly timeTicks: readonly number[];
    /** The indicator panes, top to bottom, with the range each was scaled to. */
    readonly panePlacements: readonly PanePlacement[];
}
