import { isPlanWithinBudget, type PlotSeries, type PlotTone } from '../../../shared/core/draw-plan.ts';
import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/** The palette a plan's tone resolves against, chosen by the host and not the author. */
const TONE_COLOURS: Record<PlotTone, () => string> = {
    bid: () => RENDER_PALETTE.bid,
    ask: () => RENDER_PALETTE.ask,
    amber: () => RENDER_PALETTE.amber,
    phosphor: () => RENDER_PALETTE.phosphor,
    ink: () => RENDER_PALETTE.inkPrimary,
    muted: () => RENDER_PALETTE.inkMuted,
};

/** An unconverged series is drawn thin, so it does not read as settled. */
const UNCONVERGED_DASH = [4, 3];

/**
 * Draws the plans indicators produced.
 *
 * The plan holds vertices in data space and this is the only place they become
 * pixels, which is what lets a pan re-project a plan the host already has
 * rather than asking whoever wrote the indicator for a new one.
 */
export class PlotPainter {
    /**
     * Draws every plan on the request, in the order they were declared.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        for (const plan of paint.request.plans) {
            // Rejected whole rather than clipped: half a series is a different
            // claim than the one its author made.
            if (!isPlanWithinBudget(plan)) {
                continue;
            }
            for (const series of plan.series) {
                this.paintSeries(paint, series, plan.hasConverged);
            }
        }
    }

    private paintSeries(paint: PaintContext, series: PlotSeries, hasConverged: boolean): void {
        const { context, layout, projector } = paint;
        context.strokeStyle = TONE_COLOURS[series.tone]();
        context.lineWidth = 1;
        context.setLineDash(hasConverged ? [] : UNCONVERGED_DASH);
        context.beginPath();

        let isDrawing = false;
        for (let index = 0; index < series.atMs.length; index += 1) {
            const value = series.value[index]!;
            if (Number.isNaN(value)) {
                isDrawing = false;
                continue;
            }

            const x = projector.timeToX(series.atMs[index]!);
            const y = projector.priceToY(value);
            if (x < -layout.plotWidth || x > layout.plotWidth * 2) {
                isDrawing = false;
                continue;
            }

            if (isDrawing) {
                context.lineTo(x, y);
                continue;
            }
            context.moveTo(x, y);
            isDrawing = true;
        }

        context.stroke();
        context.setLineDash([]);
    }
}
