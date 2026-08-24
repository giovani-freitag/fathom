import { choosePriceTicks, chooseTimeTicks } from '@core/domain/axis-ticks';
import { RENDER_PALETTE } from '../render-palette';
import type { PaintContext } from '../render-types';

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
        const { context, layout, projector, request } = paint;

        context.strokeStyle = RENDER_PALETTE.hairlineFaint;
        context.lineWidth = 1;
        context.beginPath();

        for (const price of choosePriceTicks(request.viewport, layout.plotHeight)) {
            const y = Math.round(projector.priceToY(price)) + 0.5;
            context.moveTo(0, y);
            context.lineTo(layout.plotWidth, y);
        }
        for (const timestampMs of chooseTimeTicks(request.viewport, layout.plotWidth)) {
            const x = Math.round(projector.timeToX(timestampMs)) + 0.5;
            context.moveTo(x, 0);
            context.lineTo(x, layout.plotHeight);
        }

        context.stroke();
    }
}
