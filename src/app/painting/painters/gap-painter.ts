import { RENDER_PALETTE } from '../render-palette.ts';
import type { PaintContext } from '../render-types.ts';

/**
 * Marks the windows during which nothing was recorded.
 *
 * A hole in the book is what a gap is: the price ran through it and only the
 * depth is missing. So the marks belong to the book, and are put down with it —
 * a reader who has seen where the holes are may want them out of the way, and
 * one who has not must never be shown a smooth line across them.
 */
export class GapPainter {
    /**
     * Draws every gap overlapping the visible range.
     *
     * @param paint - The shared paint context.
     */
    paint(paint: PaintContext): void {
        const { context, layout, projector, request } = paint;
        if (!request.areGapsVisible) {
            return;
        }

        // Down the price pane alone, not the whole stack. A hole is missing
        // depth: the executions under it were recorded, and so was everything
        // an indicator is computed from, so a mark across their bands says
        // those readings are suspect when they are not.
        const height = layout.pricePaneHeight;
        for (const span of mergeSpans(request.dataset.gaps.map((gap) => ({
            startX: projector.timeToX(gap.gapStartedAtMs),
            endX: projector.timeToX(gap.gapEndedAtMs),
        })))) {
            if (span.endX < 0 || span.startX > layout.plotWidth) {
                continue;
            }

            const width = Math.max(1, span.endX - span.startX);
            context.fillStyle = RENDER_PALETTE.gapFill;
            context.fillRect(span.startX, 0, width, height);

            context.strokeStyle = RENDER_PALETTE.gapStroke;
            context.setLineDash([3, 3]);
            context.beginPath();
            context.moveTo(span.startX, 0);
            context.lineTo(span.startX, height);
            context.moveTo(span.startX + width, 0);
            context.lineTo(span.startX + width, height);
            context.stroke();
            context.setLineDash([]);
        }
    }
}

/** One stretch of the surface a mark covers. */
interface GapSpan {
    readonly startX: number;
    readonly endX: number;
}

/**
 * Overlapping stretches joined into one.
 *
 * Both the fill and the two edges are translucent so a mark sits over the book
 * rather than hiding it. Drawn one per gap, a cluster of them lays that
 * translucency over itself until it is not translucent at all — and the
 * loudest thing on a chart about liquidity ends up being the announcement that
 * some is missing. Zoomed out far enough, every gap of a day clusters.
 *
 * @param spans - Where each gap starts and ends on the surface, in any order.
 * @returns The stretches they cover between them, left to right, none touching.
 */
function mergeSpans(spans: readonly GapSpan[]): GapSpan[] {
    const merged: GapSpan[] = [];
    for (const span of [...spans].sort((first, second) => first.startX - second.startX)) {
        const held = merged[merged.length - 1];
        if (held !== undefined && span.startX <= held.endX) {
            merged[merged.length - 1] = { startX: held.startX, endX: Math.max(held.endX, span.endX) };
            continue;
        }
        merged.push(span);
    }
    return merged;
}
