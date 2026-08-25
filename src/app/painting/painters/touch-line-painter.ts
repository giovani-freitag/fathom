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
