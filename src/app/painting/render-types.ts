import type { ChartViewport } from '../core/chart-viewport.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';
import type { ChartDataset } from '../core/chart-dataset.ts';

export interface PointerReadout {
    readonly x: number;
    readonly y: number;
}

/** Everything one paint of the chart depends on. */
export interface RenderRequest {
    readonly viewport: ChartViewport;
    readonly dataset: ChartDataset;
    readonly colourGain: number;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
    readonly pointer: PointerReadout | null;
}

/**
 * Where each band of the surface starts and ends, resolved once per paint.
 *
 * The plot gives up width when the profile panel is on, and every layer needs
 * the same answer; deriving it separately per layer is how a one-pixel
 * disagreement between the axis and the field appears.
 */
export interface ChartLayout {
    readonly plotWidth: number;
    readonly plotHeight: number;
    readonly profileX: number;
    readonly profileWidth: number;
    readonly priceAxisX: number;
    readonly priceAxisWidth: number;
    readonly isCompact: boolean;
}

/**
 * The shared argument every painter takes.
 *
 * Passing one object rather than four positional values keeps each painter's
 * signature stable as layers gain what they need, and guarantees every layer
 * measures against the same layout and projection.
 */
export interface PaintContext {
    readonly context: CanvasRenderingContext2D;
    readonly layout: ChartLayout;
    readonly projector: ViewportProjector;
    readonly request: RenderRequest;
    /** Y of the crosshair when one is over the plot, so layers can yield to it. */
    readonly crosshairY: number | null;
    /**
     * The ticks every layer must agree on.
     *
     * Resolved once and shared rather than recomputed per layer: a gridline and
     * its label disagreeing by a pixel is the kind of defect nobody can explain
     * later, and measuring label widths needs the surface's font anyway.
     */
    readonly priceTicks: readonly number[];
    readonly timeTicks: readonly number[];
}
