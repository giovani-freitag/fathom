import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/**
 * Draws the gridlines the axis labels sit on.
 *
 * Reads the same tick functions the axes do, so a line and its label can never
 * disagree about where a round price falls.
 */
export class GridPainter {
    /**
     * Draws horizontal and vertical gridlines across the plot.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const { context, layout, projector } = paint;

        context.strokeStyle = RENDER_PALETTE.hairlineFaint;
        context.lineWidth = 1;
        context.beginPath();

        for (const price of paint.priceTicks) {
            const y = Math.round(projector.priceToY(price)) + 0.5;
            context.moveTo(0, y);
            context.lineTo(layout.plotWidth, y);
        }
        for (const timestampMs of paint.timeTicks) {
            const x = Math.round(projector.timeToX(timestampMs)) + 0.5;
            context.moveTo(x, 0);
            context.lineTo(x, layout.plotHeight);
        }

        context.stroke();
    }
}
