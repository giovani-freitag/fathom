import type { ChartViewport } from '../core/chart-viewport.ts';
import type { LayerSettings } from '../indicators/field-layers.ts';
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
    /** The instant being painted, for what counts down rather than sits still. */
    readonly nowMs: number;
    readonly isDepthVisible: boolean;
    readonly isCandleOverlayVisible: boolean;
    /**
     * What each drawn layer is tuned to, by the id it was added under.
     *
     * Carried rather than unpacked: how a layer is tuned is its own vocabulary,
     * and a host that named the knobs would have to learn every layer's.
     */
    readonly layerSettings: LayerSettings;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
    readonly pointer: PointerReadout | null;
    readonly locale: Locale;
    /** What the indicators produced for this window, already computed. */
    readonly plans: readonly DrawPlan[];
    /** Named rather than read from the palette, which is mutated in place. */
    readonly theme: ResolvedTheme;
}

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

/**
 * The shared argument every painter takes.
 */
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

/**
 * A layer of the chart the host paints, contributed by whatever declared it.
 *
 * The host knows the order to paint in and the surface to paint on; what is
 * drawn, and when it is drawn at all, is the layer's own business. Adding one
 * is adding a member to a list, not a branch in the renderer.
 */
export interface FieldLayerPainter {
    /** Lower is painted first, so a higher one is painted over it. */
    readonly order: number;
    /**
     * Whether it has anything to draw with the chart in this state.
     *
     * @param request - Everything the frame is being drawn from.
     * @returns True when it should be painted.
     */
    isDrawn(request: RenderRequest): boolean;
    /**
     * Draws it.
     *
     * @param paint - The surface, the layout, and what to read.
     */
    paint(paint: PaintContext): void;
}

/**
 * A layer painted on a surface of its own, which a drag re-uses as a blit.
 *
 * Separate from the one above because it is not repainted per frame: it holds
 * whatever it built, and says for itself when that is still good.
 */
export interface FieldBackgroundPainter {
    /**
     * Draws onto the layer's own surface.
     *
     * @param request - The surface, the layout, and what to read.
     */
    paintBackground(request: BackgroundPaintRequest): void;
    /** Releases whatever it is holding. */
    dispose(): void;
}

export interface BackgroundPaintRequest {
    readonly context: CanvasRenderingContext2D;
    readonly layout: ChartLayout;
    readonly request: RenderRequest;
}

/**
 * A layer that paints in colours of its own, told when the theme changes.
 *
 * The host owns the palette but not every ramp built from it: a layer that
 * pre-renders its colours has to rebuild them, and it is the only thing that
 * knows what it built.
 */
export interface ThemedLayer {
    /**
     * Rebuilds whatever it had coloured.
     *
     * @param theme - The theme to paint from now on.
     */
    applyTheme(theme: ResolvedTheme): void;
}
