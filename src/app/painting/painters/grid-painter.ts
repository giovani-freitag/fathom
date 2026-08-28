import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/**
 * Draws the gridlines the axis labels sit on, as far as the reader wants them.
 *
 * A liquidity map is dense, and every line ruled over it competes with the data
 * underneath. The time lines are the ones that cost most — one per label, each
 * running the full height of the stack — so they are the half a reader can drop
 * on their own.
 */
export class GridPainter {
    /**
     * Draws horizontal and vertical gridlines across the plot.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const { context, layout, projector, request } = paint;
        if (request.gridChoice === 'none') {
            return;
        }

        context.strokeStyle = RENDER_PALETTE.hairlineFaint;
        context.lineWidth = 1;
        context.beginPath();

        for (const price of paint.priceTicks) {
            const y = Math.round(projector.priceToY(price)) + 0.5;
            context.moveTo(0, y);
            context.lineTo(layout.plotWidth, y);
        }
        if (request.gridChoice === 'both') {
            for (const timestampMs of paint.timeTicks) {
                const x = Math.round(projector.timeToX(timestampMs)) + 0.5;
                context.moveTo(x, 0);
                context.lineTo(x, layout.paneStackHeight);
            }
        }

        context.stroke();
    }
}
