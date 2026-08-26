import { choosePriceTicks, chooseTimeTicks } from './axis-ticks.ts';
import { buildTranslate } from '../i18n/translator.ts';
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
import { PlotPainter } from './painters/plot-painter.ts';
import { TradePainter } from './painters/trade-painter.ts';
import { VolumeProfilePainter } from './painters/volume-profile-painter.ts';
import { RENDER_METRICS } from './render-palette.ts';
import type { ChartLayout, PaintContext, RenderRequest } from './render-types.ts';
import type { DrawPlan } from '../../shared/core/draw-plan.ts';
import { countPanedPlans, placePanes } from './pane-projector.ts';

/** Retina beyond this buys nothing visible and costs four times the fill rate. */
const MAXIMUM_PIXEL_RATIO = 2;

/**
 * Clear space between time labels, as a multiple of one label's width.
 */
const TIME_LABEL_SPACING_FACTOR = 1.9;

/**
 * Clear space between price labels, in CSS pixels.
 */
const PRICE_LABEL_SPACING_PX = 56;

export type { PointerReadout, RenderRequest } from './render-types.ts';

export interface HeatmapRendererConfig {
    /** The depth field, blitted from one offscreen image. */
    readonly depthCanvas: HTMLCanvasElement;
    /** Everything drawn from the data, held between frames. */
    readonly overlayCanvas: HTMLCanvasElement;
    /** Everything drawn from the cursor, cleared and redrawn every frame. */
    readonly cursorCanvas: HTMLCanvasElement;
}

/**
 * Coordinates the layers that make up one view of the chart.
 */
export class HeatmapRenderer {
    private readonly depthCanvas: HTMLCanvasElement;
    private readonly overlayCanvas: HTMLCanvasElement;
    private readonly cursorCanvas: HTMLCanvasElement;
    private readonly depthContext: CanvasRenderingContext2D | null;
    private readonly overlayContext: CanvasRenderingContext2D | null;
    private readonly cursorContext: CanvasRenderingContext2D | null;

    private readonly depthLayerPainter = new DepthLayerPainter();
    private readonly gapPainter = new GapPainter();
    private readonly gridPainter = new GridPainter();
    private readonly volumeProfilePainter = new VolumeProfilePainter();
    private readonly candlePainter = new CandlePainter();
    private readonly tradePainter = new TradePainter();
    private readonly plotPainter = new PlotPainter();
    private readonly axisPainter = new AxisPainter();
    private readonly touchLinePainter: TouchLinePainter;
    private readonly crosshairPainter: CrosshairPainter;

    private cssWidth = 0;
    private cssHeight = 0;
    private layout: ChartLayout = EMPTY_LAYOUT;
    private cachedField: DepthField | null = null;
    private paintedOverlayKey: string | null = null;

    constructor(config: HeatmapRendererConfig) {
        this.depthCanvas = config.depthCanvas;
        this.overlayCanvas = config.overlayCanvas;
        this.cursorCanvas = config.cursorCanvas;
        this.depthContext = config.depthCanvas.getContext('2d');
        this.overlayContext = config.overlayCanvas.getContext('2d');
        this.cursorContext = config.cursorCanvas.getContext('2d');
        this.touchLinePainter = new TouchLinePainter({ axisPainter: this.axisPainter });
        this.crosshairPainter = new CrosshairPainter({ axisPainter: this.axisPainter });
    }

    /**
     * Matches every canvas to a surface size and pixel density.
     *
     * @param cssWidth - Surface width in CSS pixels.
     * @param cssHeight - Surface height in CSS pixels.
     * @param pixelRatio - Device pixel ratio to render at; capped internally.
     */
    resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
        this.cssWidth = cssWidth;
        this.cssHeight = cssHeight;
        const cappedRatio = Math.min(Math.max(pixelRatio, 1), MAXIMUM_PIXEL_RATIO);

        // Resizing a canvas clears it, which takes the held overlay with it.
        this.paintedOverlayKey = null;

        for (const canvas of [this.depthCanvas, this.overlayCanvas, this.cursorCanvas]) {
            canvas.width = Math.max(1, Math.round(cssWidth * cappedRatio));
            canvas.height = Math.max(1, Math.round(cssHeight * cappedRatio));
            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;
        }

        this.depthContext?.setTransform(cappedRatio, 0, 0, cappedRatio, 0, 0);
        this.overlayContext?.setTransform(cappedRatio, 0, 0, cappedRatio, 0, 0);
        this.cursorContext?.setTransform(cappedRatio, 0, 0, cappedRatio, 0, 0);
    }

    /**
     * Paints one complete view.
     *
     * @param request - Viewport, data, and the display settings to honour.
     */
    render(request: RenderRequest): void {
        if (this.depthContext === null || this.cursorContext === null || this.cssWidth === 0) {
            return;
        }

        this.layout = resolveChartLayout({
            cssWidth: this.cssWidth,
            cssHeight: this.cssHeight,
            isVolumeProfileVisible: request.isVolumeProfileVisible,
            indicatorPaneCount: countPanedPlans(request.plans),
        });

        this.paintDepthLayer(request);

        // Moving the cursor changes nothing the data layers drew. Repainting it
        // anyway is what makes an indicator cost its own price on every frame
        // rather than once per change.
        const overlayKey = describeOverlayState(request, this.layout);
        if (overlayKey !== this.paintedOverlayKey) {
            this.paintOverlay(this.buildPaintContext(this.overlayContext!, request));
            this.paintedOverlayKey = overlayKey;
        }
        this.paintCursor(this.buildPaintContext(this.cursorContext, request));
    }

    /**
     * Releases the cached depth image and the held overlay.
     */
    dispose(): void {
        this.cachedField = null;
        this.paintedOverlayKey = null;
    }

    private paintDepthLayer(request: RenderRequest): void {
        const context = this.depthContext!;
        context.clearRect(0, 0, this.cssWidth, this.cssHeight);

        const field = request.isDepthVisible ? this.resolveField(request) : null;
        if (field === null) {
            return;
        }
        this.depthLayerPainter.paint({ context, layout: this.layout, request, field });
    }

    /**
     * Draws what the data says, on a layer that outlives the frame.
     */
    private paintOverlay(paint: PaintContext): void {
        const { request } = paint;
        paint.context.clearRect(0, 0, this.cssWidth, this.cssHeight);

        // Clipped rather than trusted, and clipped twice. The outer bound keeps
        // any layer out of the axis gutters; the inner one keeps everything that
        // reads as a price inside the pane that has a price axis. Without the
        // second, a candle at the edge of the band draws down through an
        // oscillator and reads as part of it.
        paint.context.save();
        paint.context.beginPath();
        paint.context.rect(0, 0, paint.layout.priceAxisX, paint.layout.paneStackHeight);
        paint.context.clip();

        // A gap and the time grid belong to time, so they cross every band.
        this.gapPainter.paint(paint);
        this.gridPainter.paint(paint);

        paint.context.save();
        paint.context.beginPath();
        paint.context.rect(0, 0, paint.layout.priceAxisX, paint.layout.pricePaneHeight);
        paint.context.clip();
        if (request.isVolumeProfileVisible) {
            this.volumeProfilePainter.paint(paint);
        }
        if (request.isCandleOverlayVisible) {
            this.candlePainter.paint(paint);
        }
        if (request.isTradeOverlayVisible) {
            this.tradePainter.paint(paint);
        }
        // Last of the price layers: an indicator is drawn over what it describes.
        this.plotPainter.paintOverPrice(paint);
        paint.context.restore();

        this.plotPainter.paintInPanes(paint);
        paint.context.restore();
    }

    /**
     * Draws what the cursor says, and the axes that yield to it.
     */
    private paintCursor(paint: PaintContext): void {
        paint.context.clearRect(0, 0, this.cssWidth, this.cssHeight);

        this.touchLinePainter.paint(paint);
        this.axisPainter.paintPriceAxis(paint);
        this.axisPainter.paintTimeAxis(paint);
        this.crosshairPainter.paint(paint);
    }

    private buildPaintContext(
        context: CanvasRenderingContext2D,
        request: RenderRequest,
    ): PaintContext {
        context.font = this.layout.isCompact
            ? RENDER_METRICS.labelFontCompact
            : RENDER_METRICS.labelFont;

        const spanMs = request.viewport.toMs - request.viewport.fromMs;
        const timeLabelWidth = context.measureText(
            formatAxisTime(request.viewport.toMs, spanMs),
        ).width;

        return {
            context,
            layout: this.layout,
            translate: buildTranslate(request.locale),
            projector: new ViewportProjector({
                viewport: request.viewport,
                width: this.layout.plotWidth,
                height: this.layout.pricePaneHeight,
            }),
            request,
            crosshairY: this.resolveCrosshairY(request),
            priceTicks: choosePriceTicks({
                viewport: request.viewport,
                extentPx: this.layout.pricePaneHeight,
                minimumSpacingPx: PRICE_LABEL_SPACING_PX,
            }),
            panePlacements: placePanes(request.plans, this.layout.indicatorPanes, request.viewport),
            timeTicks: chooseTimeTicks({
                viewport: request.viewport,
                extentPx: this.layout.plotWidth,
                minimumSpacingPx: timeLabelWidth * TIME_LABEL_SPACING_FACTOR,
            }),
        };
    }

    private resolveCrosshairY(request: RenderRequest): number | null {
        const pointer = request.pointer;
        if (pointer === null || pointer.x > this.layout.plotWidth || pointer.y > this.layout.pricePaneHeight) {
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

/**
 * Everything the data layers read, as one comparable value.
 *
 * A field left out here is a stale layer: the reader changes something and the
 * chart keeps showing what it drew before. A field added that the layers do not
 * read costs a repaint that changes no pixels.
 */
function describePlan(plan: DrawPlan): string {
    return `${plan.indicatorId}:${plan.parameterSummary}:${plan.hasConverged}`;
}

function describeOverlayState(request: RenderRequest, layout: ChartLayout): string {
    const { viewport, dataset } = request;

    return [
        dataset.revision,
        dataset.instrumentSymbol,
        viewport.fromMs,
        viewport.toMs,
        viewport.lowPrice,
        viewport.highPrice,
        layout.plotWidth,
        layout.paneStackHeight,
        layout.pricePaneHeight,
        request.isCandleOverlayVisible,
        request.isTradeOverlayVisible,
        request.isVolumeProfileVisible,
        request.isDepthVisible,
        // A plan appearing, leaving or being retuned does not move the dataset,
        // so what the plans are has to be in the key itself.
        request.plans.map(describePlan).join(','),
        request.theme,
        // The volume profile writes sizes, which every language groups its own way.
        request.locale,
    ].join('|');
}
