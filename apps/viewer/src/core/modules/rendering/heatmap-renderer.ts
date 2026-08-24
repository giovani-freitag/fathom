import type { LiquidityFrame, RecordingGap } from '@fathom/contracts';
import { toBucketCentrePrice } from '@fathom/contracts';
import type { ChartViewport } from '@core/domain/chart-viewport';
import { formatAxisTagPrice, formatAxisTime, formatPrice, formatQuantity } from '@core/domain/formatting';
import { ViewportProjector } from '@core/domain/viewport-projector';
import type { ChartDataset } from '@core/modules/chart/chart-dataset';
import { DepthField } from './depth-field';
import { RENDER_METRICS, RENDER_PALETTE } from './render-palette';

/** Below this width the chart is treated as a phone and the chrome shrinks. */
const COMPACT_WIDTH_PX = 560;

export interface HeatmapRendererConfig {
    readonly depthCanvas: HTMLCanvasElement;
    readonly overlayCanvas: HTMLCanvasElement;
}

export interface PointerReadout {
    readonly x: number;
    readonly y: number;
}

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
 * The plot has to give up width when the profile panel is on, and every layer
 * needs the same answer; deriving it separately per layer is how a one-pixel
 * disagreement between the axis and the field appears.
 */
interface ChartLayout {
    readonly plotWidth: number;
    readonly plotHeight: number;
    readonly profileX: number;
    readonly profileWidth: number;
    readonly priceAxisX: number;
    readonly priceAxisWidth: number;
    readonly isCompact: boolean;
}

interface CachedField {
    readonly revision: number;
    readonly colourGain: number;
    readonly field: DepthField;
}

/**
 * Paints the depth window and its chrome onto two stacked canvases.
 *
 * The depth layer is a single scaled blit of a pre-rendered field, so a pan or a
 * pinch costs one composited draw rather than a repaint of every bucket. The
 * overlay carries everything that has to stay crisp at any zoom: axes, gaps,
 * executions, and the readout.
 */
export class HeatmapRenderer {
    private readonly depthCanvas: HTMLCanvasElement;
    private readonly overlayCanvas: HTMLCanvasElement;
    private readonly depthContext: CanvasRenderingContext2D | null;
    private readonly overlayContext: CanvasRenderingContext2D | null;

    private cssWidth = 0;
    private cssHeight = 0;
    private layout: ChartLayout = EMPTY_LAYOUT;
    private cachedField: CachedField | null = null;

    constructor(config: HeatmapRendererConfig) {
        this.depthCanvas = config.depthCanvas;
        this.overlayCanvas = config.overlayCanvas;
        this.depthContext = config.depthCanvas.getContext('2d');
        this.overlayContext = config.overlayCanvas.getContext('2d');
    }

    /**
     * Matches both canvases to a surface size and pixel density.
     *
     * @param cssWidth - Surface width in CSS pixels.
     * @param cssHeight - Surface height in CSS pixels.
     * @param pixelRatio - Device pixel ratio to render at.
     */
    resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
        this.cssWidth = cssWidth;
        this.cssHeight = cssHeight;

        for (const canvas of [this.depthCanvas, this.overlayCanvas]) {
            canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
            canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;
        }

        this.depthContext?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        this.overlayContext?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
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

        this.layout = this.resolveLayout(request.isVolumeProfileVisible);
        const projector = new ViewportProjector({
            viewport: request.viewport,
            width: this.layout.plotWidth,
            height: this.layout.plotHeight,
        });

        this.paintDepth(request);
        this.paintOverlay(request, projector);
    }

    /**
     * Releases the cached depth image.
     */
    dispose(): void {
        this.cachedField = null;
    }

    private resolveLayout(isVolumeProfileVisible: boolean): ChartLayout {
        const isCompact = this.cssWidth < COMPACT_WIDTH_PX;
        const priceAxisWidth = isCompact
            ? RENDER_METRICS.priceAxisWidthCompact
            : RENDER_METRICS.priceAxisWidth;
        const profileWidth = isVolumeProfileVisible
            ? (isCompact ? RENDER_METRICS.profileWidthCompact : RENDER_METRICS.profileWidth)
            : 0;

        const plotWidth = Math.max(1, this.cssWidth - priceAxisWidth - profileWidth);
        return {
            plotWidth,
            plotHeight: Math.max(1, this.cssHeight - RENDER_METRICS.timeAxisHeight),
            profileX: plotWidth,
            profileWidth,
            priceAxisX: plotWidth + profileWidth,
            priceAxisWidth,
            isCompact,
        };
    }

    private resolveField(request: RenderRequest): DepthField | null {
        if (request.dataset.frames.length === 0) {
            return null;
        }
        const cached = this.cachedField;
        if (
            cached !== null
            && cached.revision === request.dataset.revision
            && cached.colourGain === request.colourGain
        ) {
            return cached.field;
        }

        const field = new DepthField({ dataset: request.dataset, colourGain: request.colourGain });
        this.cachedField = { revision: request.dataset.revision, colourGain: request.colourGain, field };
        return field;
    }

    private paintDepth(request: RenderRequest): void {
        const context = this.depthContext!;
        context.clearRect(0, 0, this.cssWidth, this.cssHeight);

        const field = this.resolveField(request);
        if (field === null || field.columnCount === 0) {
            return;
        }

        const { viewport } = request;
        const sourceX = field.timeToColumn(viewport.fromMs);
        const sourceWidth = (viewport.toMs - viewport.fromMs) / field.sampleIntervalMs;
        const sourceY = field.priceToRow(viewport.highPrice);
        const sourceHeight = (viewport.highPrice - viewport.lowPrice) / field.priceBucketSize;

        if (sourceWidth <= 0 || sourceHeight <= 0) {
            return;
        }

        // Averaging only helps when buckets are being squeezed below one pixel;
        // when they are larger than a pixel, smoothing blurs the very edges that
        // make a resting wall readable.
        context.imageSmoothingEnabled = sourceHeight > this.layout.plotHeight;
        context.drawImage(
            field.canvas,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            this.layout.plotWidth,
            this.layout.plotHeight,
        );
    }

    private paintOverlay(request: RenderRequest, projector: ViewportProjector): void {
        const context = this.overlayContext!;
        context.clearRect(0, 0, this.cssWidth, this.cssHeight);
        context.font = this.layout.isCompact ? RENDER_METRICS.labelFontCompact : RENDER_METRICS.labelFont;

        this.paintGaps(context, request.dataset.gaps, projector);
        this.paintGrid(context, request.viewport, projector);

        if (request.isVolumeProfileVisible) {
            this.paintVolumeProfile(context, request, projector);
        }
        if (request.isTradeOverlayVisible) {
            this.paintTrades(context, request, projector);
        }

        this.paintTouchLine(context, request, projector);
        this.paintPriceAxis(context, request.viewport, projector);
        this.paintTimeAxis(context, request.viewport, projector);
        this.paintCrosshair(context, request, projector);
    }

    private paintGaps(
        context: CanvasRenderingContext2D,
        gaps: readonly RecordingGap[],
        projector: ViewportProjector,
    ): void {
        const plotHeight = this.layout.plotHeight;
        for (const gap of gaps) {
            const startX = projector.timeToX(gap.gapStartedAtMs);
            const endX = projector.timeToX(gap.gapEndedAtMs);
            if (endX < 0 || startX > this.layout.plotWidth) {
                continue;
            }

            const width = Math.max(1, endX - startX);
            context.fillStyle = RENDER_PALETTE.gapFill;
            context.fillRect(startX, 0, width, plotHeight);
            context.strokeStyle = RENDER_PALETTE.gapStroke;
            context.setLineDash([3, 3]);
            context.beginPath();
            context.moveTo(startX, 0);
            context.lineTo(startX, plotHeight);
            context.moveTo(startX + width, 0);
            context.lineTo(startX + width, plotHeight);
            context.stroke();
            context.setLineDash([]);
        }
    }

    private paintGrid(
        context: CanvasRenderingContext2D,
        viewport: ChartViewport,
        projector: ViewportProjector,
    ): void {
        context.strokeStyle = RENDER_PALETTE.hairlineFaint;
        context.lineWidth = 1;
        context.beginPath();

        for (const price of choosePriceTicks(viewport, this.layout.plotHeight)) {
            const y = Math.round(projector.priceToY(price)) + 0.5;
            context.moveTo(0, y);
            context.lineTo(this.layout.plotWidth, y);
        }
        for (const timestampMs of chooseTimeTicks(viewport, this.layout.plotWidth)) {
            const x = Math.round(projector.timeToX(timestampMs)) + 0.5;
            context.moveTo(x, 0);
            context.lineTo(x, this.layout.plotHeight);
        }

        context.stroke();
    }

    private paintVolumeProfile(
        context: CanvasRenderingContext2D,
        request: RenderRequest,
        projector: ViewportProjector,
    ): void {
        const { profileX, profileWidth, plotHeight } = this.layout;
        if (profileWidth === 0) {
            return;
        }

        // Its own band rather than an overlay: drawn across the field, the bars
        // sit on top of the newest depth and read as a stain on the data instead
        // of a measurement beside it.
        context.fillStyle = RENDER_PALETTE.profileBackdrop;
        context.fillRect(profileX, 0, profileWidth, plotHeight);
        context.strokeStyle = RENDER_PALETTE.hairline;
        context.beginPath();
        context.moveTo(profileX + 0.5, 0);
        context.lineTo(profileX + 0.5, plotHeight);
        context.stroke();

        const profile = buildVolumeProfile(request, projector, plotHeight);
        if (profile.maximumVolume <= 0) {
            return;
        }

        const maximumWidth = profileWidth - 2;
        const rightEdge = profileX + profileWidth;
        const barHeight = Math.max(
            1,
            projector.bucketHeight(request.dataset.clusterPriceBucketSize) - 0.5,
        );

        for (const row of profile.rows) {
            const buyWidth = (row.buyQuantity / profile.maximumVolume) * maximumWidth;
            const sellWidth = (row.sellQuantity / profile.maximumVolume) * maximumWidth;
            const top = row.y - barHeight / 2;

            context.fillStyle = RENDER_PALETTE.profileBuy;
            context.fillRect(rightEdge - buyWidth, top, buyWidth, barHeight);
            context.fillStyle = RENDER_PALETTE.profileSell;
            context.fillRect(rightEdge - buyWidth - sellWidth, top, sellWidth, barHeight);

            // Over a lit depth field a translucent bar reads as a stain rather
            // than a measurement; the cap is what gives it an edge to read against.
            context.fillStyle = RENDER_PALETTE.profileEdge;
            context.fillRect(rightEdge - buyWidth - sellWidth, top, 1, barHeight);
        }
    }

    private paintTrades(
        context: CanvasRenderingContext2D,
        request: RenderRequest,
        projector: ViewportProjector,
    ): void {
        const visibleClusters = request.dataset.clusters.filter(
            (cluster) => cluster.executedAtMs >= request.viewport.fromMs
                && cluster.executedAtMs <= request.viewport.toMs,
        );
        if (visibleClusters.length === 0) {
            return;
        }

        const largestVolume = visibleClusters.reduce(
            (running, cluster) => Math.max(running, cluster.buyQuantity + cluster.sellQuantity),
            0,
        );
        if (largestVolume <= 0) {
            return;
        }

        const { minimumBubbleRadius, maximumBubbleRadius } = RENDER_METRICS;
        const radiusSpan = (this.layout.isCompact ? 0.7 : 1) * (maximumBubbleRadius - minimumBubbleRadius);

        for (const cluster of visibleClusters) {
            const volume = cluster.buyQuantity + cluster.sellQuantity;
            const price = toBucketCentrePrice(cluster.priceBucketIndex, request.dataset.clusterPriceBucketSize);
            const x = projector.timeToX(cluster.executedAtMs);
            const y = projector.priceToY(price);
            const radius = minimumBubbleRadius + radiusSpan * Math.sqrt(volume / largestVolume);

            // Every second on a liquid contract carries a print, so a flat alpha
            // draws a continuous dotted line and hides the prints that matter.
            const emphasis = 0.22 + 0.6 * Math.sqrt(volume / largestVolume);
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fillStyle = cluster.buyQuantity >= cluster.sellQuantity
                ? `rgba(43, 212, 168, ${emphasis.toFixed(3)})`
                : `rgba(255, 92, 114, ${emphasis.toFixed(3)})`;
            context.fill();
        }
    }

    private paintTouchLine(
        context: CanvasRenderingContext2D,
        request: RenderRequest,
        projector: ViewportProjector,
    ): void {
        const newestFrame = request.dataset.frames[request.dataset.frames.length - 1];
        if (newestFrame === undefined) {
            return;
        }

        const midPrice = (newestFrame.bestBidPrice + newestFrame.bestAskPrice) / 2;
        const y = Math.round(projector.priceToY(midPrice)) + 0.5;
        if (y < 0 || y > this.layout.plotHeight) {
            return;
        }

        context.strokeStyle = RENDER_PALETTE.phosphor;
        context.lineWidth = 1;
        context.setLineDash([6, 4]);
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(this.layout.plotWidth, y);
        context.stroke();
        context.setLineDash([]);

        this.paintAxisTag(context, {
            text: formatAxisTagPrice(midPrice),
            y,
            background: RENDER_PALETTE.phosphor,
            foreground: RENDER_PALETTE.surface,
        });
    }

    private paintPriceAxis(
        context: CanvasRenderingContext2D,
        viewport: ChartViewport,
        projector: ViewportProjector,
    ): void {
        const axisX = this.layout.priceAxisX;
        context.fillStyle = RENDER_PALETTE.axisBackdrop;
        context.fillRect(axisX, 0, this.layout.priceAxisWidth, this.cssHeight);

        context.strokeStyle = RENDER_PALETTE.hairline;
        context.beginPath();
        context.moveTo(axisX + 0.5, 0);
        context.lineTo(axisX + 0.5, this.cssHeight);
        context.stroke();

        context.fillStyle = RENDER_PALETTE.inkMuted;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        for (const price of choosePriceTicks(viewport, this.layout.plotHeight)) {
            const y = projector.priceToY(price);
            if (y < 8 || y > this.layout.plotHeight - 4) {
                continue;
            }
            context.fillText(formatPrice(price), axisX + 6, y);
        }
    }

    private paintTimeAxis(
        context: CanvasRenderingContext2D,
        viewport: ChartViewport,
        projector: ViewportProjector,
    ): void {
        const axisY = this.layout.plotHeight;
        context.fillStyle = RENDER_PALETTE.axisBackdrop;
        context.fillRect(0, axisY, this.cssWidth, RENDER_METRICS.timeAxisHeight);

        context.strokeStyle = RENDER_PALETTE.hairline;
        context.beginPath();
        context.moveTo(0, axisY + 0.5);
        context.lineTo(this.cssWidth, axisY + 0.5);
        context.stroke();

        context.fillStyle = RENDER_PALETTE.inkMuted;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const spanMs = viewport.toMs - viewport.fromMs;
        for (const timestampMs of chooseTimeTicks(viewport, this.layout.plotWidth)) {
            const x = projector.timeToX(timestampMs);
            if (x < 24 || x > this.layout.plotWidth - 24) {
                continue;
            }
            context.fillText(formatAxisTime(timestampMs, spanMs), x, axisY + RENDER_METRICS.timeAxisHeight / 2);
        }
    }

    private paintCrosshair(
        context: CanvasRenderingContext2D,
        request: RenderRequest,
        projector: ViewportProjector,
    ): void {
        const pointer = request.pointer;
        if (pointer === null || pointer.x > this.layout.plotWidth || pointer.y > this.layout.plotHeight) {
            return;
        }

        context.strokeStyle = RENDER_PALETTE.crosshair;
        context.lineWidth = 1;
        context.setLineDash([2, 4]);
        context.beginPath();
        context.moveTo(Math.round(pointer.x) + 0.5, 0);
        context.lineTo(Math.round(pointer.x) + 0.5, this.layout.plotHeight);
        context.moveTo(0, Math.round(pointer.y) + 0.5);
        context.lineTo(this.layout.plotWidth, Math.round(pointer.y) + 0.5);
        context.stroke();
        context.setLineDash([]);

        const price = projector.yToPrice(pointer.y);
        this.paintAxisTag(context, {
            text: formatAxisTagPrice(price),
            y: pointer.y,
            background: RENDER_PALETTE.inkPrimary,
            foreground: RENDER_PALETTE.surface,
        });
        this.paintDepthReadout(context, {
            request,
            price,
            pointer,
            timestampMs: projector.xToTime(pointer.x),
        });
    }

    private paintDepthReadout(context: CanvasRenderingContext2D, request: DepthReadoutRequest): void {
        const { dataset } = request.request;
        // The frame under the cursor, not the newest one: while the view is
        // parked in history the newest frame describes a different minute, and a
        // readout that silently reports it is worse than no readout at all.
        const frame = findFrameNearest(dataset.frames, request.timestampMs);
        if (frame === undefined) {
            return;
        }

        const bucketIndex = Math.floor(request.price / dataset.priceBucketSize);
        const bidQuantity = frame.bids.quantities[bucketIndex - frame.bids.lowestBucketIndex] ?? 0;
        const askQuantity = frame.asks.quantities[bucketIndex - frame.asks.lowestBucketIndex] ?? 0;
        const quantity = bidQuantity > 0 ? bidQuantity : askQuantity;
        if (quantity <= 0) {
            return;
        }

        const { pointer } = request;
        const label = formatQuantity(quantity);
        const textWidth = context.measureText(label).width;
        const boxX = Math.min(pointer.x + 10, this.layout.plotWidth - textWidth - 14);

        context.fillStyle = RENDER_PALETTE.axisBackdrop;
        context.fillRect(boxX, pointer.y - 20, textWidth + 10, 16);
        context.fillStyle = bidQuantity > 0 ? RENDER_PALETTE.bid : RENDER_PALETTE.ask;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillText(label, boxX + 5, pointer.y - 12);
    }

    private paintAxisTag(context: CanvasRenderingContext2D, tag: AxisTag): void {
        const axisX = this.layout.priceAxisX;
        context.fillStyle = tag.background;
        context.fillRect(axisX + 1, tag.y - 8, this.layout.priceAxisWidth - 1, 16);
        context.fillStyle = tag.foreground;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillText(tag.text, axisX + 6, tag.y);
    }
}

interface DepthReadoutRequest {
    readonly request: RenderRequest;
    readonly price: number;
    readonly pointer: PointerReadout;
    readonly timestampMs: number;
}

interface AxisTag {
    readonly text: string;
    readonly y: number;
    readonly background: string;
    readonly foreground: string;
}

/**
 * Frame closest in time to an instant.
 *
 * Frames are already in capture order, so the scan is a bisection: a wide window
 * holds thousands and this runs on every pointer move.
 */
function findFrameNearest(
    frames: readonly LiquidityFrame[],
    timestampMs: number,
): LiquidityFrame | undefined {
    if (frames.length === 0) {
        return undefined;
    }

    let low = 0;
    let high = frames.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (frames[middle]!.capturedAtMs < timestampMs) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    const candidate = frames[low]!;
    const previous = frames[low - 1];
    if (previous === undefined) {
        return candidate;
    }
    return Math.abs(previous.capturedAtMs - timestampMs) < Math.abs(candidate.capturedAtMs - timestampMs)
        ? previous
        : candidate;
}

interface ProfileRow {
    readonly y: number;
    readonly buyQuantity: number;
    readonly sellQuantity: number;
}

interface VolumeProfile {
    readonly rows: readonly ProfileRow[];
    readonly maximumVolume: number;
}

function buildVolumeProfile(
    request: RenderRequest,
    projector: ViewportProjector,
    plotHeight: number,
): VolumeProfile {
    const volumeByBucket = new Map<number, { buyQuantity: number; sellQuantity: number }>();

    for (const cluster of request.dataset.clusters) {
        if (cluster.executedAtMs < request.viewport.fromMs || cluster.executedAtMs > request.viewport.toMs) {
            continue;
        }
        const existing = volumeByBucket.get(cluster.priceBucketIndex)
            ?? { buyQuantity: 0, sellQuantity: 0 };
        existing.buyQuantity += cluster.buyQuantity;
        existing.sellQuantity += cluster.sellQuantity;
        volumeByBucket.set(cluster.priceBucketIndex, existing);
    }

    const rows: ProfileRow[] = [];
    let maximumVolume = 0;

    for (const [bucketIndex, volume] of volumeByBucket) {
        const price = toBucketCentrePrice(bucketIndex, request.dataset.clusterPriceBucketSize);
        const y = projector.priceToY(price);
        if (y < 0 || y > plotHeight) {
            continue;
        }
        maximumVolume = Math.max(maximumVolume, volume.buyQuantity + volume.sellQuantity);
        rows.push({ y, buyQuantity: volume.buyQuantity, sellQuantity: volume.sellQuantity });
    }

    return { rows, maximumVolume };
}

const PRICE_TICK_STEPS = [1, 2, 2.5, 5, 10];
const TARGET_TICK_SPACING_PX = 64;

function choosePriceTicks(viewport: ChartViewport, plotHeight: number): number[] {
    const span = viewport.highPrice - viewport.lowPrice;
    const targetCount = Math.max(2, Math.floor(plotHeight / TARGET_TICK_SPACING_PX));
    const step = chooseNiceStep(span / targetCount);

    const ticks: number[] = [];
    const firstTick = Math.ceil(viewport.lowPrice / step) * step;
    for (let price = firstTick; price <= viewport.highPrice; price += step) {
        ticks.push(price);
    }
    return ticks;
}

const TIME_TICK_STEPS_MS = [
    1_000, 5_000, 15_000, 30_000,
    60_000, 300_000, 900_000, 1_800_000,
    3_600_000, 10_800_000, 21_600_000, 43_200_000,
    86_400_000, 172_800_000, 604_800_000,
];

function chooseTimeTicks(viewport: ChartViewport, plotWidth: number): number[] {
    const spanMs = viewport.toMs - viewport.fromMs;
    const targetCount = Math.max(2, Math.floor(plotWidth / 96));
    const desiredStep = spanMs / targetCount;
    const step = TIME_TICK_STEPS_MS.find((candidate) => candidate >= desiredStep)
        ?? TIME_TICK_STEPS_MS[TIME_TICK_STEPS_MS.length - 1]!;

    const ticks: number[] = [];
    const firstTick = Math.ceil(viewport.fromMs / step) * step;
    for (let timestampMs = firstTick; timestampMs <= viewport.toMs; timestampMs += step) {
        ticks.push(timestampMs);
    }
    return ticks;
}

function chooseNiceStep(rawStep: number): number {
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, Number.EPSILON)));
    const normalised = rawStep / magnitude;
    const step = PRICE_TICK_STEPS.find((candidate) => candidate >= normalised) ?? 10;
    return step * magnitude;
}

const EMPTY_LAYOUT: ChartLayout = {
    plotWidth: 1,
    plotHeight: 1,
    profileX: 1,
    profileWidth: 0,
    priceAxisX: 1,
    priceAxisWidth: 0,
    isCompact: false,
};
