import { buildCandleSeries, type Candle } from '../../core/candle-series.ts';
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
        const { layout, projector, request } = paint;
        const candles = buildCandleSeries({
            frames: request.dataset.frames,
            fromMs: request.viewport.fromMs,
            toMs: request.viewport.toMs,
            plotWidthPx: layout.plotWidth,
            sampleIntervalMs: request.dataset.sampleIntervalMs,
        });
        if (candles.length === 0) {
            return;
        }

        const bodyWidth = Math.max(
            1,
            projector.timeToX(candles[0]!.closedAtMs)
                - projector.timeToX(candles[0]!.openedAtMs)
                - CANDLE_GAP_PX,
        );
        for (const candle of candles) {
            this.paintCandle(paint, candle, bodyWidth);
        }
    }

    private paintCandle(paint: PaintContext, candle: Candle, bodyWidth: number): void {
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
