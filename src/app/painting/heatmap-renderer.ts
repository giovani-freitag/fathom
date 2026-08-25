import { choosePriceTicks, chooseTimeTicks } from './axis-ticks.ts';
import { formatAxisTime } from '../core/formatting.ts';
import { ViewportProjector } from '../core/viewport-projector.ts';
import { CandlePainter } from './painters/candle-painter.ts';
import { EMPTY_LAYOUT, resolveChartLayout } from './chart-layout.ts';
import { DepthField } from './depth-field.ts';
import { AxisPainter } from './painters/axis-painter.ts';
import { CrosshairPainter } from './painters/crosshair-painter.ts';
import { DepthLayerPainter } from './painters/depth-layer-painter.ts';
import { GapPainter } from './painters/gap-painter.ts';
import { GridPainter } from './painters/grid-painter.ts';
import { TouchLinePainter } from './painters/touch-line-painter.ts';
import { TradePainter } from './painters/trade-painter.ts';
import { VolumeProfilePainter } from './painters/volume-profile-painter.ts';
import { RENDER_METRICS } from './render-palette.ts';
import type { ChartLayout, PaintContext, RenderRequest } from './render-types.ts';

/** Retina beyond this buys nothing visible and costs four times the fill rate. */
const MAXIMUM_PIXEL_RATIO = 2;

/**
 * Clear space between time labels, as a multiple of one label's width.
 *
 * Horizontal crowding is a width problem: a label reading `18:52:15` needs far
 * more room than one reading `13/ago`, and the axis has to adapt to whichever
 * the current span produces.
 */
const TIME_LABEL_SPACING_FACTOR = 1.9;

/**
 * Clear space between price labels, in CSS pixels.
 *
 * Vertical crowding is a line-height problem, not a width one: how many digits a
 * price has says nothing about how close two of them can sit.
 */
const PRICE_LABEL_SPACING_PX = 56;

export type { PointerReadout, RenderRequest } from './render-types.ts';

export interface HeatmapRendererConfig {
    readonly depthCanvas: HTMLCanvasElement;
    readonly overlayCanvas: HTMLCanvasElement;
}

/**
 * Coordinates the layers that make up one view of the chart.
 *
 * Owns the two canvases, the layout, and the cached depth field, and nothing
 * else: each layer decides for itself what it draws, so a change to the profile
 * panel cannot disturb the axes and a new layer costs one line here.
 *
 * The depth layer sits underneath as a single scaled blit and the chrome on top,
 * so a pointer move repaints only the thin overlay.
 */
export class HeatmapRenderer {
    private readonly depthCanvas: HTMLCanvasElement;
    private readonly overlayCanvas: HTMLCanvasElement;
    private readonly depthContext: CanvasRenderingContext2D | null;
    private readonly overlayContext: CanvasRenderingContext2D | null;

    private readonly depthLayerPainter = new DepthLayerPainter();
    private readonly gapPainter = new GapPainter();
    private readonly gridPainter = new GridPainter();
    private readonly volumeProfilePainter = new VolumeProfilePainter();
    private readonly candlePainter = new CandlePainter();
    private readonly tradePainter = new TradePainter();
    private readonly axisPainter = new AxisPainter();
    private readonly touchLinePainter: TouchLinePainter;
    private readonly crosshairPainter: CrosshairPainter;

    private cssWidth = 0;
    private cssHeight = 0;
    private layout: ChartLayout = EMPTY_LAYOUT;
    private cachedField: DepthField | null = null;

    constructor(config: HeatmapRendererConfig) {
        this.depthCanvas = config.depthCanvas;
        this.overlayCanvas = config.overlayCanvas;
        this.depthContext = config.depthCanvas.getContext('2d');
        this.overlayContext = config.overlayCanvas.getContext('2d');
        this.touchLinePainter = new TouchLinePainter({ axisPainter: this.axisPainter });
        this.crosshairPainter = new CrosshairPainter({ axisPainter: this.axisPainter });
    }

    /**
     * Matches both canvases to a surface size and pixel density.
     *
     * @param cssWidth - Surface width in CSS pixels.
     * @param cssHeight - Surface height in CSS pixels.
     * @param pixelRatio - Device pixel ratio to render at; capped internally.
     */
    resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
        this.cssWidth = cssWidth;
        this.cssHeight = cssHeight;
        const cappedRatio = Math.min(Math.max(pixelRatio, 1), MAXIMUM_PIXEL_RATIO);

        for (const canvas of [this.depthCanvas, this.overlayCanvas]) {
            canvas.width = Math.max(1, Math.round(cssWidth * cappedRatio));
            canvas.height = Math.max(1, Math.round(cssHeight * cappedRatio));
            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;
        }

        this.depthContext?.setTransform(cappedRatio, 0, 0, cappedRatio, 0, 0);
        this.overlayContext?.setTransform(cappedRatio, 0, 0, cappedRatio, 0, 0);
    }

    /**
     * Paints one complete view.
     *
     * @param request - Viewport, data, and the display settings to honour.
     */
    render(request: RenderRequest): void {
        if (this.depthContext === null || this.overlayContext === null || this.cssWidth === 0) {
            return;
        }

        this.layout = resolveChartLayout({
            cssWidth: this.cssWidth,
            cssHeight: this.cssHeight,
            isVolumeProfileVisible: request.isVolumeProfileVisible,
        });

        this.paintDepthLayer(request);
        this.paintOverlay(request);
    }

    /**
     * Releases the cached depth image.
     */
    dispose(): void {
        this.cachedField = null;
    }

    private paintDepthLayer(request: RenderRequest): void {
        const context = this.depthContext!;
        context.clearRect(0, 0, this.cssWidth, this.cssHeight);

        const field = this.resolveField(request);
        if (field === null) {
            return;
        }
        this.depthLayerPainter.paint({ context, layout: this.layout, request, field });
    }

    private paintOverlay(request: RenderRequest): void {
        const context = this.overlayContext!;
        context.clearRect(0, 0, this.cssWidth, this.cssHeight);
        context.font = this.layout.isCompact
            ? RENDER_METRICS.labelFontCompact
            : RENDER_METRICS.labelFont;

        const spanMs = request.viewport.toMs - request.viewport.fromMs;
        const timeLabelWidth = context.measureText(
            formatAxisTime(request.viewport.toMs, spanMs),
        ).width;

        const paint: PaintContext = {
            context,
            layout: this.layout,
            projector: new ViewportProjector({
                viewport: request.viewport,
                width: this.layout.plotWidth,
                height: this.layout.plotHeight,
            }),
            request,
            crosshairY: this.resolveCrosshairY(request),
            priceTicks: choosePriceTicks({
                viewport: request.viewport,
                extentPx: this.layout.plotHeight,
                minimumSpacingPx: PRICE_LABEL_SPACING_PX,
            }),
            timeTicks: chooseTimeTicks({
                viewport: request.viewport,
                extentPx: this.layout.plotWidth,
                minimumSpacingPx: timeLabelWidth * TIME_LABEL_SPACING_FACTOR,
            }),
        };

        this.gapPainter.paint(paint);
        this.gridPainter.paint(paint);
        if (request.isVolumeProfileVisible) {
            this.volumeProfilePainter.paint(paint);
        }
        if (request.isCandleOverlayVisible) {
            this.candlePainter.paint(paint);
        }
        if (request.isTradeOverlayVisible) {
            this.tradePainter.paint(paint);
        }
        this.touchLinePainter.paint(paint);
        this.axisPainter.paintPriceAxis(paint);
        this.axisPainter.paintTimeAxis(paint);
        this.crosshairPainter.paint(paint);
    }

    private resolveCrosshairY(request: RenderRequest): number | null {
        const pointer = request.pointer;
        if (pointer === null || pointer.x > this.layout.plotWidth || pointer.y > this.layout.plotHeight) {
            return null;
        }
        return pointer.y;
    }

    private resolveField(request: RenderRequest): DepthField | null {
        if (request.dataset.frames.length === 0) {
            return null;
        }

        // A streamed second changes one column. Letting the field absorb it beats
        // rebuilding the window, which costs tens of milliseconds twice a second
        // and is felt as stutter on a phone long before it is on a desktop.
        const cached = this.cachedField;
        if (cached !== null && cached.absorb(request.dataset, request.colourGain)) {
            return cached;
        }

        const field = new DepthField({ dataset: request.dataset, colourGain: request.colourGain });
        this.cachedField = field;
        return field;
    }
}
