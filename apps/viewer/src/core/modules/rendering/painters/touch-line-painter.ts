import { findFrameNearest } from '@core/domain/dataset-lookup';
import { RENDER_PALETTE } from '../render-palette';
import type { PaintContext } from '../render-types';
import { AXIS_TAG_HEIGHT, type AxisPainter } from './axis-painter';

export interface TouchLinePainterConfig {
    readonly axisPainter: AxisPainter;
}

/**
 * Marks the price the book was trading around at the right edge of the view.
 *
 * The right edge, not the newest frame loaded: parked in history those are an
 * hour apart, and drawing today's price across yesterday's depth invites reading
 * it as the price back then. At the live edge the two coincide, so the line
 * still marks the current touch whenever the chart is following.
 *
 * It spans the whole plot because it is the reference every wall on screen is
 * judged against, including the ones far to the left.
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
        if (y < 0 || y > layout.plotHeight) {
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
    }
}
