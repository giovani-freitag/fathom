import { type CandleStyle, CANDLES_LAYER, readCandleSettings } from './candles.ts';
import { classifyBar, type PriceBar } from '../../../shared/core/price-bar.ts';
import { RENDER_PALETTE } from '../../painting/render-palette.ts';
import type { FieldLayerPainter, PaintContext, RenderRequest } from '../../painting/render-types.ts';

/** Gap left between neighbouring bars, so a run reads as bars not a block. */
const CANDLE_GAP_PX = 2;

/** A body this thin is a doji; drawn as a rule so it does not vanish. */
const MINIMUM_BODY_HEIGHT_PX = 1;

/** The dash a partial bar and a void share with the gap band already drawn. */
const INCOMPLETE_DASH = [3, 3];

/** How far the open and close ticks of an OHLC bar reach either side of it. */
const TICK_RATIO = 0.45;

/** Where the fill under an area chart fades out, as a fraction of full colour. */
const AREA_FADE = 0.22;

/**
 * Draws the price track as bars over the depth field.
 *
 * A bar says what it was built from, and this draws that distinction: a whole
 * bar is filled, a bar the collector missed seconds of is outlined in the same
 * amber the gap band uses, and one still being filled is hollow. Painting all
 * three the same way is what let a chart claim continuous price through a
 * stretch nothing was recorded in.
 */
export class CandlePainter implements FieldLayerPainter {
    /** Over the backdrop and under what crossed it, because the price is the thing the rest is read against. */
    readonly order = 20;

    /**
     * Whether the chart is showing it.
     *
     * @param request - Everything the frame is being drawn from.
     * @returns True while the reading it draws is on the chart.
     */
    isDrawn(request: RenderRequest): boolean {
        return request.isCandleOverlayVisible;
    }

    /**
     * Draws every bar that fits the visible window.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const { projector, request } = paint;
        const { bars } = request.dataset;
        // The warm-up prefix is what the averages were seeded from, not what the
        // reader asked to see; drawing it would show history the window is not
        // claiming to cover.
        const drawn = bars.bars.slice(bars.warmupBarsReturned);
        if (drawn.length === 0) {
            return;
        }

        const style = readCandleSettings(request.layerSettings[CANDLES_LAYER.id]).candleStyle;
        if (style === 'line' || style === 'area') {
            this.paintTrack(paint, drawn, style);
            return;
        }

        const bodyWidth = Math.max(
            1,
            projector.timeToX(drawn[0]!.closedAtMs)
                - projector.timeToX(drawn[0]!.openedAtMs)
                - CANDLE_GAP_PX,
        );

        let previous: PriceBar | null = null;
        for (const bar of drawn) {
            if (previous !== null && bar.openedAtMs > previous.closedAtMs) {
                this.paintVoid(paint, previous.closedAtMs, bar.openedAtMs);
            }
            this.paintCandle(paint, bar, bodyWidth, style);
            previous = bar;
        }
    }

    /**
     * Draws the closes as one run, optionally filled beneath.
     *
     * One colour rather than one per bar: a track says where the price went,
     * and colouring each leg by its own direction turns a shape into confetti.
     */
    private paintTrack(paint: PaintContext, bars: readonly PriceBar[], style: CandleStyle): void {
        const { context, layout, projector } = paint;
        const first = bars[0]!;
        const last = bars[bars.length - 1]!;
        const isRising = last.closePrice >= first.closePrice;
        const colour = isRising ? RENDER_PALETTE.bid : RENDER_PALETTE.ask;

        context.beginPath();
        for (const [index, bar] of bars.entries()) {
            const x = projector.timeToX((bar.openedAtMs + bar.closedAtMs) / 2);
            const y = projector.priceToY(bar.closePrice);
            if (index === 0) {
                context.moveTo(x, y);
                continue;
            }
            context.lineTo(x, y);
        }

        if (style === 'area') {
            context.save();
            const gradient = context.createLinearGradient(0, 0, 0, layout.pricePaneHeight);
            gradient.addColorStop(0, colour);
            gradient.addColorStop(1, 'transparent');
            context.globalAlpha = AREA_FADE;
            context.fillStyle = gradient;
            context.lineTo(projector.timeToX((last.openedAtMs + last.closedAtMs) / 2), layout.pricePaneHeight);
            context.lineTo(projector.timeToX((first.openedAtMs + first.closedAtMs) / 2), layout.pricePaneHeight);
            context.closePath();
            context.fill();
            context.restore();
            this.paintTrack(paint, bars, 'line');
            return;
        }

        context.strokeStyle = colour;
        context.lineWidth = 1.5;
        context.lineJoin = 'round';
        context.stroke();
        context.lineWidth = 1;
    }

    /**
     * Marks a stretch where no bucket exists at all.
     */
    private paintVoid(paint: PaintContext, fromMs: number, toMs: number): void {
        const { context, layout, projector } = paint;
        const left = projector.timeToX(fromMs);
        const right = projector.timeToX(toMs);
        if (right < 0 || left > layout.plotWidth) {
            return;
        }

        const middleY = Math.round(layout.pricePaneHeight / 2) + 0.5;
        context.strokeStyle = RENDER_PALETTE.gapStroke;
        context.lineWidth = 1;
        context.setLineDash(INCOMPLETE_DASH);
        context.beginPath();
        context.moveTo(Math.max(0, left), middleY);
        context.lineTo(Math.min(layout.plotWidth, right), middleY);
        context.stroke();
        context.setLineDash([]);
    }

    private paintCandle(
        paint: PaintContext,
        bar: PriceBar,
        bodyWidth: number,
        style: CandleStyle,
    ): void {
        const { context, layout, projector } = paint;
        const left = projector.timeToX(bar.openedAtMs);
        if (left + bodyWidth < 0 || left > layout.plotWidth) {
            return;
        }

        const completeness = classifyBar(bar);
        const isRising = bar.closePrice >= bar.openPrice;
        const colour = completeness === 'partial'
            ? RENDER_PALETTE.gapStroke
            : (isRising ? RENDER_PALETTE.bid : RENDER_PALETTE.ask);

        const highY = projector.priceToY(bar.highPrice);
        const lowY = projector.priceToY(bar.lowPrice);
        const openY = projector.priceToY(bar.openPrice);
        const closeY = projector.priceToY(bar.closePrice);

        context.strokeStyle = colour;
        context.lineWidth = 1;
        context.setLineDash(completeness === 'partial' ? INCOMPLETE_DASH : []);
        context.beginPath();
        const wickX = Math.round(left + bodyWidth / 2) + 0.5;
        context.moveTo(wickX, highY);
        context.lineTo(wickX, lowY);
        context.stroke();
        context.setLineDash([]);

        // Two ticks and no body: what the bar opened and closed at, read off
        // the same vertical the wick already drew.
        if (style === 'bars') {
            const reach = Math.max(1, Math.round(bodyWidth * TICK_RATIO));
            context.beginPath();
            context.moveTo(wickX - reach, Math.round(openY) + 0.5);
            context.lineTo(wickX, Math.round(openY) + 0.5);
            context.moveTo(wickX, Math.round(closeY) + 0.5);
            context.lineTo(wickX + reach, Math.round(closeY) + 0.5);
            context.stroke();
            return;
        }

        const bodyTop = Math.round(Math.min(openY, closeY));
        const bodyHeight = Math.max(MINIMUM_BODY_HEIGHT_PX, Math.abs(closeY - openY));
        const bodyLeft = Math.round(left);
        const width = Math.round(bodyWidth);

        // Hollow while the bucket can still grow, filled once it cannot. A bar
        // being written is not a bar with something wrong with it. Hollow
        // candles say the same about direction: a rising bar is left open.
        const isFilled = completeness === 'whole' && !(style === 'hollow' && isRising);
        if (isFilled) {
            context.fillStyle = colour;
            context.fillRect(bodyLeft, bodyTop, width, bodyHeight);
            return;
        }
        context.strokeStyle = colour;
        context.strokeRect(bodyLeft + 0.5, bodyTop + 0.5, Math.max(1, width - 1), bodyHeight);
    }
}
