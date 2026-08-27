import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/**
 * Marks the windows during which nothing was recorded.
 */
export class GapPainter {
    /**
     * Draws every gap overlapping the visible range.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const { context, layout, projector, request } = paint;

        for (const gap of request.dataset.gaps) {
            const startX = projector.timeToX(gap.gapStartedAtMs);
            const endX = projector.timeToX(gap.gapEndedAtMs);
            if (endX < 0 || startX > layout.plotWidth) {
                continue;
            }

            const width = Math.max(1, endX - startX);
            context.fillStyle = RENDER_PALETTE.gapFill;
            context.fillRect(startX, 0, width, layout.paneStackHeight);

            context.strokeStyle = RENDER_PALETTE.gapStroke;
            context.setLineDash([3, 3]);
            context.beginPath();
            context.moveTo(startX, 0);
            context.lineTo(startX, layout.paneStackHeight);
            context.moveTo(startX + width, 0);
            context.lineTo(startX + width, layout.paneStackHeight);
            context.stroke();
            context.setLineDash([]);
        }
    }
}
