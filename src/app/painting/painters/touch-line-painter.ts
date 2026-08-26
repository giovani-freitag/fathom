import { findFrameNearest } from '../../core/dataset-lookup.ts';
import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';
import { AXIS_TAG_HEIGHT, type AxisPainter } from './axis-painter.ts';

export interface TouchLinePainterConfig {
    readonly axisPainter: AxisPainter;
}

/**
 * Marks the price the book was trading around at the right edge of the view.
 */
export class TouchLinePainter {
    private readonly axisPainter: AxisPainter;

    constructor(config: TouchLinePainterConfig) {
        this.axisPainter = config.axisPainter;
    }

    /**
     * Draws the mid-price line and pins its price into the axis.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const { context, layout, projector, request } = paint;
        const edgeFrame = findFrameNearest(request.dataset.frames, request.viewport.toMs);
        if (edgeFrame === undefined) {
            return;
        }

        const midPrice = (edgeFrame.bestBidPrice + edgeFrame.bestAskPrice) / 2;
        const y = Math.round(projector.priceToY(midPrice)) + 0.5;
        if (y < 0 || y > layout.pricePaneHeight) {
            return;
        }

        context.strokeStyle = RENDER_PALETTE.phosphor;
        context.lineWidth = 1;
        context.setLineDash([6, 4]);
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(layout.plotWidth, y);
        context.stroke();
        context.setLineDash([]);

        // The crosshair's tag is the one the reader is actively pointing at, so
        // this one yields when the two would land on top of each other.
        if (paint.crosshairY !== null && Math.abs(paint.crosshairY - y) < AXIS_TAG_HEIGHT) {
            return;
        }
        this.axisPainter.paintPriceTag(paint, {
            price: midPrice,
            y,
            background: RENDER_PALETTE.phosphor,
            foreground: RENDER_PALETTE.surface,
        });
        this.paintCountdown(paint, y);
    }

    /**
     * Writes how long the bar being built still has to run.
     *
     * Measured against the edge of the view rather than the clock: panned into
     * history there is no bar being built, and a countdown there would be
     * counting down to a moment already past.
     */
    private paintCountdown(paint: PaintContext, y: number): void {
        const { bars } = paint.request.dataset;
        const newest = bars.bars[bars.bars.length - 1];
        if (newest === undefined || bars.intervalMs <= 0) {
            return;
        }

        const remainingMs = newest.closedAtMs - paint.request.viewport.toMs;
        if (remainingMs <= 0 || remainingMs > bars.intervalMs) {
            return;
        }
        this.axisPainter.paintCountdownTag(paint, y, formatCountdown(remainingMs));
    }
}

/**
 * A countdown as minutes and seconds, or as seconds alone under a minute.
 *
 * @param remainingMs - How much of the bar is left.
 * @returns The formatted countdown.
 */
function formatCountdown(remainingMs: number): string {
    const totalSeconds = Math.ceil(remainingMs / 1_000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
