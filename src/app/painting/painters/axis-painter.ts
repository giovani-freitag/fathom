import {
    formatAxisTagPrice,
    formatShortAxisPrice,
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

/** How close two labels may come before one has to give way. */
const PANE_LABEL_LINE_HEIGHT_PX = 11;

/**
 * Space between a price label and the edge of the axis it sits in.
 *
 * Tighter on a phone, where the axis is only as wide as its widest label plus
 * this twice: every pixel spent here is a pixel the chart does not get.
 */
const AXIS_PADDING_PX = 6;
const AXIS_PADDING_COMPACT_PX = 4;

/**
 * How far in from the axis edge its labels are written.
 *
 * @param layout - The layout in force, for how much room the axis has.
 * @returns The padding in pixels.
 */
function readAxisPadding(layout: { readonly isCompact: boolean }): number {
    return layout.isCompact ? AXIS_PADDING_COMPACT_PX : AXIS_PADDING_PX;
}

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

        context.fillStyle = RENDER_PALETTE.axisLabel;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        const tickSpacing = Math.abs((paint.priceTicks[1] ?? 0) - (paint.priceTicks[0] ?? 0));
        for (const price of paint.priceTicks) {
            const y = projector.priceToY(price);
            if (y < 8 || y > layout.pricePaneHeight - 4) {
                continue;
            }
            // Abbreviated only where the axis is narrow: on a phone it is the
            // difference between a label that fits and one that runs off.
            const label = layout.isCompact
                ? formatShortAxisPrice(price, tickSpacing)
                : formatPrice(price);
            context.fillText(label, axisX + readAxisPadding(layout), y);
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
        context.fillStyle = RENDER_PALETTE.axisLabel;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const spanMs = request.viewport.toMs - request.viewport.fromMs;

        for (const [index, timestampMs] of paint.timeTicks.entries()) {
            const label = formatAxisTime(timestampMs, spanMs, paint.timeTicks[index - 1]);
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
        context.fillText(
            formatAxisTagPrice(tag.price, layout.isCompact),
            layout.priceAxisX + readAxisPadding(layout),
            tag.y,
        );
    }

    /**
     * Pins a countdown into the price axis, under whatever tag it belongs to.
     *
     * @param paint - The shared paint context.
     * @param y - Where the tag it belongs to sits.
     * @param label - What to write, already formatted.
     */
    paintCountdownTag(paint: PaintContext, y: number, label: string): void {
        const { context, layout } = paint;
        const top = y + AXIS_TAG_HEIGHT / 2;
        if (top + AXIS_TAG_HEIGHT > layout.paneStackHeight) {
            return;
        }

        context.fillStyle = RENDER_PALETTE.surface;
        context.fillRect(layout.priceAxisX + 1, top, layout.priceAxisWidth - 1, AXIS_TAG_HEIGHT);
        context.fillStyle = RENDER_PALETTE.axisLabel;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillText(label, layout.priceAxisX + readAxisPadding(layout), top + AXIS_TAG_HEIGHT / 2);
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

        context.fillStyle = RENDER_PALETTE.axisLabel;
        context.textAlign = 'left';
        context.textBaseline = 'middle';

        for (const placement of paint.panePlacements) {
            const digits = resolvePaneScaleDigits(placement.high - placement.low);
            const labelX = layout.priceAxisX + PANE_LABEL_INSET_PX;
            // Abbreviated in the compact gutter, as the price ticks already
            // are. Written out in 46 pixels, a five-figure reading loses its
            // last digit off the edge of the phone.
            const write = (value: number, y: number): void => {
                const digitsHere = Number.isInteger(value) ? 0 : digits;
                context.fillText(
                    layout.isCompact
                        ? formatShortPaneValue(value, digitsHere)
                        : formatFixed(value, digitsHere),
                    labelX,
                    y,
                );
            };

            const highY = placement.rect.topY + PANE_LABEL_MARGIN_PX;
            const lowY = placement.rect.topY + placement.rect.height - PANE_LABEL_MARGIN_PX;
            write(placement.high, highY);
            write(placement.low, lowY);

            const projector = new PaneProjector(placement);
            for (const level of placement.levels) {
                const y = projector.valueToY(level.value);
                // A level that lands on the band's own reach is written twice,
                // one glyph over the other, and neither can be read. The reach
                // is the one that stays: it is what the band is scaled to.
                if (Math.abs(y - highY) < PANE_LABEL_LINE_HEIGHT_PX
                    || Math.abs(y - lowY) < PANE_LABEL_LINE_HEIGHT_PX) {
                    continue;
                }
                write(level.value, y);
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

/**
 * A band's figure, short enough for a gutter a phone can spare.
 *
 * @param value - What the band reaches, or a level inside it.
 * @param digits - Decimal places the band's own span calls for.
 * @returns The figure, with a magnitude suffix once it would not otherwise fit.
 */
function formatShortPaneValue(value: number, digits: number): string {
    const size = Math.abs(value);
    if (size >= 1_000_000) {
        return `${formatFixed(value / 1_000_000, 1)}M`;
    }
    if (size >= 1_000) {
        return `${formatFixed(value / 1_000, 1)}K`;
    }
    return formatFixed(value, digits);
}
