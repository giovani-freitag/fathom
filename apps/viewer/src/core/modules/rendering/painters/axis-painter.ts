import { choosePriceTicks, chooseTimeTicks } from '@core/domain/axis-ticks';
import {
    formatAxisTagPrice,
    formatAxisTime,
    formatClockTime,
    formatPrice,
} from '@core/domain/formatting';
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
     * Draws the time axis: its gutter, its labels, and the instant pinned on it.
     *
     * The pinned tag is drawn here rather than by the crosshair so the axis can
     * drop the labels it covers. Painting them independently leaves the ends of
     * a covered label sticking out either side of the tag, which reads as two
     * overlapping times.
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

        const pinnedTag = this.resolvePinnedTimeTag(paint);
        context.fillStyle = RENDER_PALETTE.inkMuted;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const spanMs = request.viewport.toMs - request.viewport.fromMs;

        for (const timestampMs of chooseTimeTicks(request.viewport, layout.plotWidth)) {
            const label = formatAxisTime(timestampMs, spanMs);
            const x = projector.timeToX(timestampMs);

            // Measured rather than assumed: labels are centred on their tick, so
            // a fixed inset lets the first and last one hang off the edge and
            // lose a digit, which is worse than not drawing them.
            const halfWidth = context.measureText(label).width / 2;
            if (x - halfWidth < 0 || x + halfWidth > layout.plotWidth) {
                continue;
            }
            if (pinnedTag !== null && x + halfWidth > pinnedTag.left && x - halfWidth < pinnedTag.right) {
                continue;
            }
            context.fillText(label, x, axisY + RENDER_METRICS.timeAxisHeight / 2);
        }

        if (pinnedTag !== null) {
            this.drawTimeTag(paint, pinnedTag);
        }
    }

    private resolvePinnedTimeTag(paint: PaintContext): PinnedTimeTag | null {
        const pointer = paint.request.pointer;
        if (pointer === null || paint.crosshairY === null) {
            return null;
        }

        const label = formatClockTime(paint.projector.xToTime(pointer.x));
        const width = paint.context.measureText(label).width + 10;
        const left = Math.min(Math.max(pointer.x - width / 2, 0), paint.layout.plotWidth - width);
        return { label, left, right: left + width };
    }

    private drawTimeTag(paint: PaintContext, tag: PinnedTimeTag): void {
        const { context, layout } = paint;
        const width = tag.right - tag.left;

        context.fillStyle = RENDER_PALETTE.inkPrimary;
        context.fillRect(tag.left, layout.plotHeight, width, RENDER_METRICS.timeAxisHeight);
        context.fillStyle = RENDER_PALETTE.surface;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(
            tag.label,
            tag.left + width / 2,
            layout.plotHeight + RENDER_METRICS.timeAxisHeight / 2,
        );
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

}

interface PinnedTimeTag {
    readonly label: string;
    readonly left: number;
    readonly right: number;
}
