import { classifyBar, type PriceBar } from '../../../shared/core/price-bar.ts';
import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/** Gap left between neighbouring bars, so a run reads as bars not a block. */
const CANDLE_GAP_PX = 2;

/** A body this thin is a doji; drawn as a rule so it does not vanish. */
const MINIMUM_BODY_HEIGHT_PX = 1;

/** The dash a partial bar and a void share with the gap band already drawn. */
const INCOMPLETE_DASH = [3, 3];

/**
 * Draws the price track as bars over the depth field.
 *
 * A bar says what it was built from, and this draws that distinction: a whole
 * bar is filled, a bar the collector missed seconds of is outlined in the same
 * amber the gap band uses, and one still being filled is hollow. Painting all
 * three the same way is what let a chart claim continuous price through a
 * stretch nothing was recorded in.
 */
export class CandlePainter {
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
            this.paintCandle(paint, bar, bodyWidth);
            previous = bar;
        }
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

        const middleY = Math.round(layout.plotHeight / 2) + 0.5;
        context.strokeStyle = RENDER_PALETTE.gapStroke;
        context.lineWidth = 1;
        context.setLineDash(INCOMPLETE_DASH);
        context.beginPath();
        context.moveTo(Math.max(0, left), middleY);
        context.lineTo(Math.min(layout.plotWidth, right), middleY);
        context.stroke();
        context.setLineDash([]);
    }

    private paintCandle(paint: PaintContext, bar: PriceBar, bodyWidth: number): void {
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

        const bodyTop = Math.round(Math.min(openY, closeY));
        const bodyHeight = Math.max(MINIMUM_BODY_HEIGHT_PX, Math.abs(closeY - openY));
        const bodyLeft = Math.round(left);
        const width = Math.round(bodyWidth);

        // Hollow while the bucket can still grow, filled once it cannot. A bar
        // being written is not a bar with something wrong with it.
        if (completeness === 'whole') {
            context.fillStyle = colour;
            context.fillRect(bodyLeft, bodyTop, width, bodyHeight);
            return;
        }
        context.strokeStyle = colour;
        context.strokeRect(bodyLeft + 0.5, bodyTop + 0.5, Math.max(1, width - 1), bodyHeight);
    }
}
