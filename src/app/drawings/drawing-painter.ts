import { boundDrawing, type Drawing } from '../../shared/core/drawing.ts';
import type { FieldLayerPainter, PaintContext, RenderRequest } from '../painting/render-types.ts';
import { RENDER_PALETTE, resolveToneColour } from '../painting/render-palette.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';

/** Painted over every indicator: a reader's own mark is not something to bury. */
const DRAWING_ORDER = 900;

const LINE_WIDTH_PX = 1.5;

/** Radius of the grip shown at each anchor of the selected mark. */
const HANDLE_RADIUS_PX = 5;

/** A mark still being dragged out reads as provisional. */
const DRAFT_DASH = [5, 4];

/** How much of a zone's colour survives, so the depth map under it still reads. */
const ZONE_FILL_ALPHA = 0.12;

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
            this.drawOne({ paint, drawing, isSelected: drawing.id === drawings.selectedId });
        }
        if (drawings.draft !== null) {
            this.drawOne({ paint, drawing: drawings.draft, isSelected: false, dash: DRAFT_DASH });
        }
    }

    /**
     * Draws one mark in whatever shape its kind takes.
     */
    private drawOne(stroke: DrawingStroke): void {
        const { paint, drawing, isSelected } = stroke;
        paint.context.save();
        paint.context.strokeStyle = resolveToneColour(drawing.tone);
        paint.context.lineWidth = isSelected ? LINE_WIDTH_PX * 2 : LINE_WIDTH_PX;
        paint.context.setLineDash([...stroke.dash ?? []]);

        if (drawing.kind === 'zone') {
            this.strokeZone(stroke);
        } else {
            this.strokeLine(stroke);
        }
        paint.context.restore();

        if (isSelected) {
            this.markAnchors(paint, drawing);
        }
    }

    /**
     * Strokes a level or a segment across the span it is drawn over.
     */
    private strokeLine(stroke: DrawingStroke): void {
        const { paint, drawing } = stroke;
        const span = resolveSpan(drawing, paint.layout.plotWidth, paint.projector);
        if (span === null) {
            return;
        }

        paint.context.beginPath();
        paint.context.moveTo(span.fromX, span.fromY);
        paint.context.lineTo(span.toX, span.toY);
        paint.context.stroke();
    }

    /**
     * Outlines a zone and tints what it covers.
     */
    private strokeZone(stroke: DrawingStroke): void {
        const { paint, drawing } = stroke;
        const box = resolveBox(drawing, paint.projector);
        if (box === null) {
            return;
        }

        paint.context.globalAlpha = ZONE_FILL_ALPHA;
        paint.context.fillStyle = resolveToneColour(drawing.tone);
        paint.context.fillRect(box.x, box.y, box.width, box.height);
        paint.context.globalAlpha = 1;
        paint.context.strokeRect(box.x, box.y, box.width, box.height);
    }

    /**
     * Puts a grip on each anchor, so what a drag would move is visible.
     */
    private markAnchors(paint: PaintContext, drawing: Drawing): void {
        const { context, layout, projector } = paint;
        context.save();
        context.fillStyle = resolveToneColour(drawing.tone);
        context.strokeStyle = RENDER_PALETTE.surface;
        context.lineWidth = 2;

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

export interface DrawnBox {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Where a line starts and ends on the surface.
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
 * The rectangle a zone covers, in surface pixels.
 *
 * @param drawing - The zone to place.
 * @param projector - What turns chart coordinates into pixels.
 * @returns The box, or null when the mark has no two anchors.
 */
export function resolveBox(drawing: Drawing, projector: ViewportProjector): DrawnBox | null {
    const bounds = boundDrawing(drawing);
    if (bounds === null) {
        return null;
    }

    const x = projector.timeToX(bounds.fromMs);
    const y = projector.priceToY(bounds.highPrice);
    return {
        x,
        y,
        width: projector.timeToX(bounds.toMs) - x,
        height: projector.priceToY(bounds.lowPrice) - y,
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
