import type { Drawing } from '../../shared/core/drawing.ts';
import type { FieldLayerPainter, PaintContext, RenderRequest } from '../painting/render-types.ts';
import { RENDER_PALETTE, resolveToneColour } from '../painting/render-palette.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';

/** Painted over every indicator: a reader's own mark is not something to bury. */
const DRAWING_ORDER = 900;

const LINE_WIDTH_PX = 1.5;

/** Radius of the grip shown at each anchor of the selected mark. */
const HANDLE_RADIUS_PX = 3.5;

/** A mark still being dragged out reads as provisional. */
const DRAFT_DASH = [5, 4];

/**
 * What the reader has drawn on this chart, and what they are drawing now.
 */
export interface DrawingsView {
    readonly settled: readonly Drawing[];
    readonly draft: Drawing | null;
    readonly selectedId: string | null;
}

export const EMPTY_DRAWINGS_VIEW: DrawingsView = { settled: [], draft: null, selectedId: null };

/**
 * Draws the marks a reader left, pinned to the instants they were left at.
 */
export class DrawingPainter implements FieldLayerPainter {
    readonly order = DRAWING_ORDER;

    /**
     * Whether anything is drawn on this contract's chart.
     *
     * @param request - Everything the frame is being drawn from.
     * @returns True when a mark or a draft belongs to the contract on screen.
     */
    isDrawn(request: RenderRequest): boolean {
        return request.drawings.draft !== null
            || readOwnDrawings(request).length > 0;
    }

    /**
     * Draws every mark, and the grips of the one that is selected.
     *
     * @param paint - The surface, the layout, and what to read.
     */
    paint(paint: PaintContext): void {
        const { drawings } = paint.request;
        for (const drawing of readOwnDrawings(paint.request)) {
            this.strokeDrawing({ paint, drawing, isSelected: drawing.id === drawings.selectedId });
        }
        if (drawings.draft !== null) {
            this.strokeDrawing({ paint, drawing: drawings.draft, isSelected: false, dash: DRAFT_DASH });
        }
    }

    /**
     * Strokes one mark across the span it is drawn over.
     */
    private strokeDrawing(stroke: DrawingStroke): void {
        const { paint, drawing, isSelected } = stroke;
        const { context, layout, projector } = paint;
        const span = resolveSpan(drawing, layout.plotWidth, projector);
        if (span === null) {
            return;
        }

        context.save();
        context.strokeStyle = resolveToneColour(drawing.tone);
        context.lineWidth = isSelected ? LINE_WIDTH_PX * 2 : LINE_WIDTH_PX;
        context.setLineDash([...stroke.dash ?? []]);
        context.beginPath();
        context.moveTo(span.fromX, span.fromY);
        context.lineTo(span.toX, span.toY);
        context.stroke();
        context.restore();

        if (isSelected) {
            this.markAnchors(paint, drawing);
        }
    }

    /**
     * Puts a grip on each anchor, so what a drag would move is visible.
     */
    private markAnchors(paint: PaintContext, drawing: Drawing): void {
        const { context, layout, projector } = paint;
        context.save();
        context.fillStyle = resolveToneColour(drawing.tone);
        context.strokeStyle = RENDER_PALETTE.surface;
        context.lineWidth = 1;

        for (const anchor of drawing.anchors) {
            // A level is pinned to a price and drawn across the whole window, so
            // its grip belongs where the reader can reach it rather than at an
            // instant that may be off screen.
            const x = drawing.kind === 'horizontal-line'
                ? layout.plotWidth / 2
                : projector.timeToX(anchor.atMs);
            context.beginPath();
            context.arc(x, projector.priceToY(anchor.price), HANDLE_RADIUS_PX, 0, Math.PI * 2);
            context.fill();
            context.stroke();
        }
        context.restore();
    }
}

interface DrawingStroke {
    readonly paint: PaintContext;
    readonly drawing: Drawing;
    /** Drawn heavier, with its anchors gripped. */
    readonly isSelected: boolean;
    /** Set while a mark is still being dragged out, so it reads as provisional. */
    readonly dash?: readonly number[];
}

interface DrawnSpan {
    readonly fromX: number;
    readonly fromY: number;
    readonly toX: number;
    readonly toY: number;
}

/**
 * Where a mark starts and ends on the surface.
 *
 * @param drawing - The mark to place.
 * @param plotWidth - How wide the plot is, for a level that crosses all of it.
 * @param projector - What turns chart coordinates into pixels.
 * @returns The two ends, or null when the mark has no anchors to place.
 */
function resolveSpan(
    drawing: Drawing,
    plotWidth: number,
    projector: ViewportProjector,
): DrawnSpan | null {
    const [first, second] = drawing.anchors;
    if (first === undefined) {
        return null;
    }

    if (second === undefined) {
        const y = projector.priceToY(first.price);
        return { fromX: 0, fromY: y, toX: plotWidth, toY: y };
    }
    return {
        fromX: projector.timeToX(first.atMs),
        fromY: projector.priceToY(first.price),
        toX: projector.timeToX(second.atMs),
        toY: projector.priceToY(second.price),
    };
}

/**
 * The marks drawn about the contract on screen.
 *
 * @param request - Everything the frame is being drawn from.
 * @returns Only what belongs to this chart.
 */
function readOwnDrawings(request: RenderRequest): readonly Drawing[] {
    return request.drawings.settled.filter(
        (drawing) => drawing.instrumentSymbol === request.dataset.instrumentSymbol,
    );
}

/**
 * A key that changes whenever the marks would be drawn differently.
 *
 * @param view - What is drawn and what is selected.
 * @returns A string the overlay cache can compare.
 */
export function describeDrawings(view: DrawingsView): string {
    const settled = view.settled.map(describeDrawing).join(';');
    return `${settled}|${view.draft === null ? '' : describeDrawing(view.draft)}|${view.selectedId ?? ''}`;
}

function describeDrawing(drawing: Drawing): string {
    const anchors = drawing.anchors.map((anchor) => `${anchor.atMs}:${anchor.price}`).join(',');
    return `${drawing.id}@${drawing.tone}@${anchors}`;
}
