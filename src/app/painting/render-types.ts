import type { ChartViewport } from '../core/chart-viewport.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';
import type { ChartDataset } from '../core/chart-dataset.ts';
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
    readonly isCandleOverlayVisible: boolean;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
    readonly pointer: PointerReadout | null;
    /** The crosshair readout is the one place the canvas writes prose. */
    readonly translate: Translate;
}

/**
 * Where each band of the surface starts and ends, resolved once per paint.
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
     */
    readonly priceTicks: readonly number[];
    readonly timeTicks: readonly number[];
}
