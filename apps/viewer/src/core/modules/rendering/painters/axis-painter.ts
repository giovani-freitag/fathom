import { choosePriceTicks, chooseTimeTicks } from '@core/domain/axis-ticks';
import { formatAxisTagPrice, formatAxisTime, formatPrice } from '@core/domain/formatting';
import { RENDER_METRICS, RENDER_PALETTE } from '../render-palette';
import type { PaintContext } from '../render-types';

/** Height of a tag pinned into the price axis, and the distance two need to clear. */
export const AXIS_TAG_HEIGHT = 16;

export interface PriceTag {
    readonly price: number;
    readonly y: number;
    readonly background: string;
    readonly foreground: string;
}

/**
 * Draws the two axes, and the tags other layers pin into them.
 *
 * Tags live here rather than with the layers that request them so a pinned price
 * always lands in the same band, at the same height, whichever layer asked.
 */
export class AxisPainter {
    /**
     * Draws the price axis gutter and its labels.
     *
     * @param paint - The shared paint context.
     */
    paintPriceAxis(paint: PaintContext): void {
        const { context, layout, projector, request } = paint;
        const axisX = layout.priceAxisX;

        context.fillStyle = RENDER_PALETTE.axisBackdrop;
        context.fillRect(axisX, 0, layout.priceAxisWidth, layout.plotHeight + RENDER_METRICS.timeAxisHeight);
        context.strokeStyle = RENDER_PALETTE.hairline;
        context.beginPath();
        context.moveTo(axisX + 0.5, 0);
        context.lineTo(axisX + 0.5, layout.plotHeight + RENDER_METRICS.timeAxisHeight);
        context.stroke();

        context.fillStyle = RENDER_PALETTE.inkMuted;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        for (const price of choosePriceTicks(request.viewport, layout.plotHeight)) {
            const y = projector.priceToY(price);
            if (y < 8 || y > layout.plotHeight - 4) {
                continue;
            }
            context.fillText(formatPrice(price), axisX + 6, y);
        }
    }

    /**
     * Draws the time axis gutter and its labels.
     *
     * @param paint - The shared paint context.
     */
    paintTimeAxis(paint: PaintContext): void {
        const { context, layout, projector, request } = paint;
        const axisY = layout.plotHeight;

        context.fillStyle = RENDER_PALETTE.axisBackdrop;
        context.fillRect(0, axisY, layout.priceAxisX, RENDER_METRICS.timeAxisHeight);
        context.strokeStyle = RENDER_PALETTE.hairline;
        context.beginPath();
        context.moveTo(0, axisY + 0.5);
        context.lineTo(layout.priceAxisX, axisY + 0.5);
        context.stroke();

        context.fillStyle = RENDER_PALETTE.inkMuted;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const spanMs = request.viewport.toMs - request.viewport.fromMs;
        for (const timestampMs of chooseTimeTicks(request.viewport, layout.plotWidth)) {
            const x = projector.timeToX(timestampMs);
            if (x < 24 || x > layout.plotWidth - 24) {
                continue;
            }
            context.fillText(
                formatAxisTime(timestampMs, spanMs),
                x,
                axisY + RENDER_METRICS.timeAxisHeight / 2,
            );
        }
    }

    /**
     * Pins a price into the price axis.
     *
     * @param paint - The shared paint context.
     * @param tag - The price, its height on screen, and its colours.
     */
    paintPriceTag(paint: PaintContext, tag: PriceTag): void {
        const { context, layout } = paint;

        context.fillStyle = tag.background;
        context.fillRect(
            layout.priceAxisX + 1,
            tag.y - AXIS_TAG_HEIGHT / 2,
            layout.priceAxisWidth - 1,
            AXIS_TAG_HEIGHT,
        );
        context.fillStyle = tag.foreground;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillText(formatAxisTagPrice(tag.price), layout.priceAxisX + 6, tag.y);
    }

    /**
     * Pins a label into the time axis, kept inside the plot's bounds.
     *
     * @param paint - The shared paint context.
     * @param label - Text to pin.
     * @param x - Where on the plot the label points at.
     */
    paintTimeTag(paint: PaintContext, label: string, x: number): void {
        const { context, layout } = paint;
        const labelWidth = context.measureText(label).width + 10;
        const left = Math.min(Math.max(x - labelWidth / 2, 0), layout.plotWidth - labelWidth);

        context.fillStyle = RENDER_PALETTE.inkPrimary;
        context.fillRect(left, layout.plotHeight, labelWidth, RENDER_METRICS.timeAxisHeight);
        context.fillStyle = RENDER_PALETTE.surface;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(
            label,
            left + labelWidth / 2,
            layout.plotHeight + RENDER_METRICS.timeAxisHeight / 2,
        );
    }
}
