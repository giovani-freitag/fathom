import type { PriceBar } from '../../../shared/core/price-bar.ts';
import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/** Gap left between neighbouring candles, so a run reads as bars not a block. */
const CANDLE_GAP_PX = 2;

/** A body this thin is a doji; drawn as a rule so it does not vanish. */
const MINIMUM_BODY_HEIGHT_PX = 1;

/**
 * Draws the price track as candles over the depth field.
 */
export class CandlePainter {
    /**
     * Draws every candle that fits the visible window.
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
        for (const bar of drawn) {
            this.paintCandle(paint, bar, bodyWidth);
        }
    }

    private paintCandle(paint: PaintContext, candle: PriceBar, bodyWidth: number): void {
        const { context, layout, projector } = paint;
        const left = projector.timeToX(candle.openedAtMs);
        if (left + bodyWidth < 0 || left > layout.plotWidth) {
            return;
        }

        const isRising = candle.closePrice >= candle.openPrice;
        const colour = isRising ? RENDER_PALETTE.bid : RENDER_PALETTE.ask;
        const highY = projector.priceToY(candle.highPrice);
        const lowY = projector.priceToY(candle.lowPrice);
        const openY = projector.priceToY(candle.openPrice);
        const closeY = projector.priceToY(candle.closePrice);

        context.strokeStyle = colour;
        context.lineWidth = 1;
        context.beginPath();
        const wickX = Math.round(left + bodyWidth / 2) + 0.5;
        context.moveTo(wickX, highY);
        context.lineTo(wickX, lowY);
        context.stroke();

        context.fillStyle = colour;
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(MINIMUM_BODY_HEIGHT_PX, Math.abs(closeY - openY));
        context.fillRect(Math.round(left), Math.round(bodyTop), Math.round(bodyWidth), bodyHeight);
    }
}
