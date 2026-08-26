import {
    formatAxisTagPrice,
    formatFixed,
    formatAxisTime,
    formatClockTime,
    formatPrice,
} from '../../core/formatting.ts';
import { PaneProjector } from '../pane-projector.ts';
import { RENDER_METRICS, RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/** Height of a tag pinned into the price axis, and the distance two need to clear. */
export const PANE_LABEL_INSET_PX = 6;
const PANE_LABEL_MARGIN_PX = 10;

export const AXIS_TAG_HEIGHT = 16;

export interface PriceTag {
    readonly price: number;
    readonly y: number;
    readonly background: string;
    readonly foreground: string;
}

/**
 * Draws the two axes, and the tags other layers pin into them.
 */
export class AxisPainter {
    /**
     * Draws the price axis gutter and its labels.
     *
     * @param paint - The shared paint context.
     */
    paintPriceAxis(paint: PaintContext): void {
        const { context, layout, projector } = paint;
        const axisX = layout.priceAxisX;

        // The gutter beside the price, and the gutter under the time, but not the
        // stretch beside an indicator pane: this layer sits over the one the
        // panes label themselves on, and an opaque fill there would bury it.
        context.fillStyle = RENDER_PALETTE.axisBackdrop;
        context.fillRect(axisX, 0, layout.priceAxisWidth, layout.pricePaneHeight);
        context.fillRect(
            axisX,
            layout.paneStackHeight,
            layout.priceAxisWidth,
            RENDER_METRICS.timeAxisHeight,
        );
        context.strokeStyle = RENDER_PALETTE.hairline;
        context.beginPath();
        context.moveTo(axisX + 0.5, 0);
        context.lineTo(axisX + 0.5, layout.paneStackHeight + RENDER_METRICS.timeAxisHeight);
        context.stroke();

        this.paintPaneScales(paint);

        context.fillStyle = RENDER_PALETTE.inkMuted;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        for (const price of paint.priceTicks) {
            const y = projector.priceToY(price);
            if (y < 8 || y > layout.pricePaneHeight - 4) {
                continue;
            }
            context.fillText(formatPrice(price), axisX + 6, y);
        }
    }

    /**
     * Draws the time axis: its gutter, its labels, and the instant pinned on it.
     *
     * @param paint - The shared paint context.
     */
    paintTimeAxis(paint: PaintContext): void {
        const { context, layout, projector, request } = paint;
        const axisY = layout.paneStackHeight;

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

        for (const timestampMs of paint.timeTicks) {
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
        context.fillRect(tag.left, layout.paneStackHeight, width, RENDER_METRICS.timeAxisHeight);
        context.fillStyle = RENDER_PALETTE.surface;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(
            tag.label,
            tag.left + width / 2,
            layout.paneStackHeight + RENDER_METRICS.timeAxisHeight / 2,
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

    /**
     * Labels the top and bottom of each indicator band in the gutter beside it.
     *
     * Two figures rather than a ladder of ticks: a band is a few dozen pixels
     * tall, and what a reader needs from it is the reach of the scale, not a
     * value they could have read off the line.
     */
    private paintPaneScales(paint: PaintContext): void {
        const { context, layout } = paint;

        context.fillStyle = RENDER_PALETTE.inkMuted;
        context.textAlign = 'left';
        context.textBaseline = 'middle';

        for (const placement of paint.panePlacements) {
            const digits = resolvePaneScaleDigits(placement.high - placement.low);
            const labelX = layout.priceAxisX + PANE_LABEL_INSET_PX;
            context.fillText(
                formatFixed(placement.high, digits),
                labelX,
                placement.rect.topY + PANE_LABEL_MARGIN_PX,
            );
            context.fillText(
                formatFixed(placement.low, digits),
                labelX,
                placement.rect.topY + placement.rect.height - PANE_LABEL_MARGIN_PX,
            );

            const projector = new PaneProjector(placement);
            for (const level of placement.levels) {
                context.fillText(
                    formatFixed(level.value, Number.isInteger(level.value) ? 0 : digits),
                    labelX,
                    projector.valueToY(level.value),
                );
            }
        }
    }
}

/**
 * Decimal places that keep a band's labels telling a reader something different.
 */
function resolvePaneScaleDigits(span: number): number {
    if (span >= 100) {
        return 0;
    }
    if (span >= 10) {
        return 1;
    }
    return span >= 1 ? 2 : 4;
}

interface PinnedTimeTag {
    readonly label: string;
    readonly left: number;
    readonly right: number;
}
