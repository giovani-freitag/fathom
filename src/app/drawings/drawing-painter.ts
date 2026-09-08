import {
    boundDrawing,
    type Drawing,
    FIBONACCI_RATIOS,
    type DrawingStyle,
    type DrawingWidth,
    readStoredGlyph,
    resolveDrawingLabel,
    resolveDrawingLook,
} from '../../shared/core/drawing.ts';
import type { FieldLayerPainter, PaintContext, RenderRequest } from '../painting/render-types.ts';
import {
    formatDuration,
    formatSignedChange,
    formatSignedPercent,
} from '../core/formatting.ts';
import { RENDER_METRICS, RENDER_PALETTE, resolveToneColour } from '../painting/render-palette.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';

/** Painted over every indicator: a reader's own mark is not something to bury. */
const DRAWING_ORDER = 900;

/** How heavy each weight draws, and how much heavier when it is selected. */
const WIDTH_PIXELS: Readonly<Record<DrawingWidth, number>> = {
    thin: 1,
    medium: 1.75,
    thick: 3,
};

const SELECTED_WIDTH_FACTOR = 1.8;

/** How much bigger a chosen emoji is drawn, since a line width says nothing. */
const SELECTED_GLYPH_FACTOR = 1.25;

/** Whatever the host has that draws emoji, and the text font behind it. */
const GLYPH_FONT_STACK = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/**
 * How much wider a highlighter is than the pen, and how much of it shows.
 *
 * A highlighter is a pen held sideways: the same stroke, laid down broad
 * enough to cover what it is drawn over and thin enough to leave it legible.
 */
const HIGHLIGHTER_WIDTH_FACTOR = 6;
const HIGHLIGHTER_ALPHA = 0.28;

/**
 * How a laser's trail is drawn: heavier than a line, faint at the tail.
 *
 * Heavier because it is a pointer and not a mark, and the eye has to find
 * it while it is moving; faint at the tail so the trail says which way.
 */
const LASER_WIDTH_FACTOR = 2.5;
const LASER_TAIL_ALPHA = 0.08;

/** How tall an emoji is drawn, by the weight the reader chose for it. */
const GLYPH_SIZE_PX: Readonly<Record<DrawingWidth, number>> = {
    thin: 16,
    medium: 22,
    thick: 32,
};

/** How each line is broken up. Solid says so with no dashes at all. */
const STYLE_DASHES: Readonly<Record<DrawingStyle, readonly number[]>> = {
    solid: [],
    dashed: [7, 5],
    dotted: [1, 4],
};

/** Where a retracement writes its own ratio, and how far it sits off the line. */
const FIBONACCI_LABEL_INSET_PX = 6;
const FIBONACCI_LABEL_LIFT_PX = 7;

/** How far a mark's name sits off the mark, and in from the edge. */
const LABEL_LIFT_PX = 5;
const LABEL_INSET_PX = 6;

/** Radius of the grip shown at each anchor of the selected mark. */
const HANDLE_RADIUS_PX = 5;

/** A mark still being dragged out reads as provisional. */
const DRAFT_DASH = [5, 4];

/** How much of a zone's colour survives, so the depth map under it still reads. */
const ZONE_FILL_ALPHA = 0.12;

/** Half the width of the arrow head a measurement is read along. */
const ARROW_HEAD_HALF_WIDTH_PX = 5;
const ARROW_HEAD_LENGTH_PX = 9;

/** Padding inside the box a measurement's figures are written in. */
const READOUT_PADDING_X = 8;
const READOUT_PADDING_Y = 6;
const READOUT_LINE_HEIGHT_PX = 15;
const READOUT_CORNER_RADIUS = 6;

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
    /**
     * What it draws is the marks themselves.
     *
     * @param request - Everything the frame is being drawn from.
     * @returns The marks, as the key the renderer already builds for them.
     */
    describe(request: RenderRequest): string {
        return describeDrawings(request.drawings);
    }

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
        const look = resolveDrawingLook(drawing);
        const weight = WIDTH_PIXELS[look.width];

        paint.context.save();
        paint.context.strokeStyle = resolveToneColour(drawing.tone);
        paint.context.lineWidth = isSelected ? weight * SELECTED_WIDTH_FACTOR : weight;
        paint.context.lineCap = look.style === 'dotted' ? 'round' : 'butt';
        paint.context.setLineDash([...stroke.dash ?? STYLE_DASHES[look.style]]);

        if (drawing.kind === 'laser') {
            this.strokeLaser(stroke);
        } else if (drawing.kind === 'emoji') {
            this.strokeGlyph(stroke, look.width);
        } else if (drawing.kind === 'highlighter') {
            // Broad, soft and never dashed: a dashed highlighter covers half of
            // what it was drawn over, which is the half a reader wanted seen.
            paint.context.lineWidth *= HIGHLIGHTER_WIDTH_FACTOR;
            paint.context.globalAlpha = HIGHLIGHTER_ALPHA;
            paint.context.lineCap = 'round';
            paint.context.lineJoin = 'round';
            paint.context.setLineDash([]);
            this.strokePath(stroke);
        } else if (drawing.kind === 'freehand') {
            paint.context.lineCap = 'round';
            paint.context.lineJoin = 'round';
            this.strokePath(stroke);
        } else if (drawing.kind === 'measure') {
            this.strokeMeasure(stroke);
        } else if (drawing.kind === 'fibonacci') {
            this.strokeFibonacci(stroke);
        } else if (drawing.kind === 'zone') {
            this.strokeZone(stroke);
        } else {
            this.strokeLine(stroke);
        }
        paint.context.restore();

        if (isSelected) {
            this.markAnchors(paint, drawing);
        }
        this.writeLabel(stroke);
    }

    /**
     * Writes what the reader called the mark, beside the mark.
     *
     * Along the line for a segment, because a name written level over a sloped
     * line belongs to neither the line nor the chart under it; level for
     * everything else, which is how everything else is read.
     */
    private writeLabel(stroke: DrawingStroke): void {
        const { paint, drawing } = stroke;
        const label = resolveDrawingLabel(drawing);
        const placement = label === null ? null : this.placeLabel(paint, drawing);
        if (label === null || placement === null) {
            return;
        }

        const { context } = paint;
        context.save();
        context.font = RENDER_METRICS.labelFont;
        context.fillStyle = resolveToneColour(drawing.tone);
        context.textBaseline = 'bottom';
        context.textAlign = placement.align;
        context.translate(placement.x, placement.y);
        context.rotate(placement.angle);
        context.fillText(label, 0, -LABEL_LIFT_PX);
        context.restore();
    }

    /**
     * Where a mark's name sits, and which way up it reads.
     */
    private placeLabel(paint: PaintContext, drawing: Drawing): LabelPlacement | null {
        if (drawing.kind === 'trend-line') {
            return this.placeAlongLine(paint, drawing);
        }

        const [first] = drawing.anchors;
        if (first === undefined) {
            return null;
        }
        // A level runs the whole window and a box has a corner: both read from
        // the left, which is where the eye starts.
        const box = boundDrawing(drawing);
        const y = paint.projector.priceToY(box === null ? first.price : box.highPrice);
        const x = box === null ? LABEL_INSET_PX : paint.projector.timeToX(box.fromMs);
        return { x: Math.max(LABEL_INSET_PX, x), y, angle: 0, align: 'left' };
    }

    /**
     * The middle of a segment, turned to lie along it.
     */
    private placeAlongLine(paint: PaintContext, drawing: Drawing): LabelPlacement | null {
        const span = resolveSpan(drawing, paint.layout.plotWidth, paint.projector);
        if (span === null) {
            return null;
        }

        const angle = Math.atan2(span.toY - span.fromY, span.toX - span.fromX);
        return {
            x: (span.fromX + span.toX) / 2,
            y: (span.fromY + span.toY) / 2,
            // Turned back the right way up where the line runs leftward, so the
            // name is never read upside down.
            angle: Math.abs(angle) > Math.PI / 2 ? angle + Math.PI : angle,
            align: 'center',
        };
    }

    /**
     * Draws the trail behind a laser, brightest where the hand is.
     *
     * Segment by segment rather than as one path: a canvas stroke carries one
     * alpha, and the fade along the trail is the whole of what makes a sweep
     * read as a sweep instead of a line. The order of the points is their age,
     * so nothing has to be timed or stamped to know which end is now.
     */
    private strokeLaser(stroke: DrawingStroke): void {
        const { paint, drawing } = stroke;
        const points = drawing.anchors.map((anchor) => ({
            x: paint.projector.timeToX(anchor.atMs),
            y: paint.projector.priceToY(anchor.price),
        }));
        if (points.length < 2) {
            return;
        }

        paint.context.setLineDash([]);
        paint.context.lineCap = 'round';
        paint.context.lineJoin = 'round';
        paint.context.lineWidth *= LASER_WIDTH_FACTOR;
        for (let index = 1; index < points.length; index += 1) {
            paint.context.globalAlpha = LASER_TAIL_ALPHA
                + (1 - LASER_TAIL_ALPHA) * (index / (points.length - 1));
            paint.context.beginPath();
            paint.context.moveTo(points[index - 1]!.x, points[index - 1]!.y);
            paint.context.lineTo(points[index]!.x, points[index]!.y);
            paint.context.stroke();
        }
    }

    /**
     * Draws the mark a reader pinned to one place.
     *
     * Filled rather than stroked, and centred on its anchor: an emoji is a
     * glyph and not a shape, so the line width and the dash the rest of a
     * mark's look decides say nothing about it — only how big it is drawn.
     */
    private strokeGlyph(stroke: DrawingStroke, width: DrawingWidth): void {
        const { paint, drawing, isSelected } = stroke;
        const [anchor] = drawing.anchors;
        if (anchor === undefined) {
            return;
        }

        const sizePx = GLYPH_SIZE_PX[width] * (isSelected ? SELECTED_GLYPH_FACTOR : 1);
        paint.context.setLineDash([]);
        // Filled text takes the fill, and the rest of a mark's look sets only
        // the stroke: left alone the glyph took whatever colour the last thing
        // painted happened to leave. Colour emoji carry their own and ignore
        // this; a host with none falls back to a shape, and that shape reads.
        paint.context.fillStyle = resolveToneColour(drawing.tone);
        paint.context.font = `${String(Math.round(sizePx))}px ${GLYPH_FONT_STACK}`;
        paint.context.textAlign = 'center';
        paint.context.textBaseline = 'middle';
        paint.context.fillText(
            readStoredGlyph(drawing),
            paint.projector.timeToX(anchor.atMs),
            paint.projector.priceToY(anchor.price),
        );
    }

    /**
     * Draws the path the hand left, anchor by anchor.
     *
     * Every anchor rather than its ends: a stroke is the shape between them,
     * and read as a pair it would straighten into the segment a trend line
     * already draws.
     */
    private strokePath(stroke: DrawingStroke): void {
        const { paint, drawing } = stroke;
        const [first, ...rest] = drawing.anchors;
        if (first === undefined) {
            return;
        }

        const points = [first, ...rest].map((anchor) => ({
            x: paint.projector.timeToX(anchor.atMs),
            y: paint.projector.priceToY(anchor.price),
        }));

        paint.context.beginPath();
        paint.context.moveTo(points[0]!.x, points[0]!.y);
        // Curved through the midpoints rather than joined corner to corner: a
        // hand moves in arcs and the points are what a pointer happened to
        // report along one, so the corners are the sampling and not the stroke.
        // Each point becomes the control of a curve ending halfway to the next,
        // which passes smoothly through every one of them without having to fit
        // anything.
        for (let index = 1; index < points.length - 1; index += 1) {
            const control = points[index]!;
            const next = points[index + 1]!;
            paint.context.quadraticCurveTo(
                control.x,
                control.y,
                (control.x + next.x) / 2,
                (control.y + next.y) / 2,
            );
        }
        // The last point is an end, not a control: curved to the midpoint the
        // stroke would stop short of where the hand did.
        const last = points[points.length - 1]!;
        paint.context.lineTo(last.x, last.y);
        paint.context.stroke();
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
     * Rules the retracements of a move, each named by the ratio it is.
     *
     * Drawn across the whole window rather than only between the two anchors: a
     * retracement is a price to watch, and price arrives to the right of where
     * the move was drawn.
     */
    private strokeFibonacci(stroke: DrawingStroke): void {
        const { paint, drawing } = stroke;
        const [from, to] = drawing.anchors;
        if (from === undefined || to === undefined) {
            return;
        }

        const { context } = paint;
        context.font = RENDER_METRICS.labelFont;
        context.textBaseline = 'middle';
        // Written at the right end, beside the price axis the level is read
        // against — and clear of the corner a selected mark opens its panel in.
        context.textAlign = 'right';

        for (const ratio of FIBONACCI_RATIOS) {
            const price = from.price + (to.price - from.price) * ratio;
            const y = Math.round(paint.projector.priceToY(price)) + 0.5;
            // The ends of the move are the move itself, so they are drawn solid
            // and the retracements between them are not.
            context.setLineDash(ratio === 0 || ratio === 1 ? [] : [4, 4]);
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(paint.layout.plotWidth, y);
            context.stroke();

            context.fillStyle = resolveToneColour(drawing.tone);
            context.fillText(
                formatRatio(ratio),
                paint.layout.plotWidth - FIBONACCI_LABEL_INSET_PX,
                y - FIBONACCI_LABEL_LIFT_PX,
            );
        }
    }

    /**
     * Shades what a measurement covers and writes what it came to.
     *
     * Coloured by which way price went rather than by the mark's own tone: the
     * answer is the reading, and a measurement drawn in the next colour of the
     * cycle would say nothing about it.
     */
    private strokeMeasure(stroke: DrawingStroke): void {
        const { paint, drawing } = stroke;
        const [from, to] = drawing.anchors;
        const box = resolveBox(drawing, paint.projector);
        if (from === undefined || to === undefined || box === null) {
            return;
        }

        const colour = resolveToneColour(to.price >= from.price ? 'bid' : 'ask');
        const { context } = paint;
        context.strokeStyle = colour;
        context.globalAlpha = ZONE_FILL_ALPHA;
        context.fillStyle = colour;
        context.fillRect(box.x, box.y, box.width, box.height);
        context.globalAlpha = 1;
        context.strokeRect(box.x, box.y, box.width, box.height);

        this.strokeArrow(paint, {
            x: box.x + box.width / 2,
            fromY: paint.projector.priceToY(from.price),
            toY: paint.projector.priceToY(to.price),
        });
        this.writeReading(paint, drawing, box);
    }

    /**
     * Draws the arrow the measurement is read along, from where to where.
     */
    private strokeArrow(paint: PaintContext, span: MeasuredSpan): void {
        const { context } = paint;
        const direction = span.toY >= span.fromY ? 1 : -1;

        context.setLineDash([]);
        context.beginPath();
        context.moveTo(span.x, span.fromY);
        context.lineTo(span.x, span.toY);
        context.moveTo(span.x - ARROW_HEAD_HALF_WIDTH_PX, span.toY - ARROW_HEAD_LENGTH_PX * direction);
        context.lineTo(span.x, span.toY);
        context.lineTo(span.x + ARROW_HEAD_HALF_WIDTH_PX, span.toY - ARROW_HEAD_LENGTH_PX * direction);
        context.stroke();
    }

    /**
     * Writes how far price moved, in both of the ways a reader asks it.
     */
    private writeReading(paint: PaintContext, drawing: Drawing, box: DrawnBox): void {
        const [from, to] = drawing.anchors;
        if (from === undefined || to === undefined) {
            return;
        }

        const deltaPrice = to.price - from.price;
        const lines = [
            `${formatSignedChange(deltaPrice)}  ${formatSignedPercent(deltaPrice / from.price)}`,
            formatDuration(Math.abs(to.atMs - from.atMs), paint.translate),
        ];

        const { context } = paint;
        context.font = RENDER_METRICS.labelFont;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const width = Math.max(...lines.map((line) => context.measureText(line).width))
            + READOUT_PADDING_X * 2;
        const height = lines.length * READOUT_LINE_HEIGHT_PX + READOUT_PADDING_Y * 2;
        const centreX = box.x + box.width / 2;
        const centreY = box.y + box.height / 2;

        context.setLineDash([]);
        context.fillStyle = RENDER_PALETTE.readoutBackdrop;
        context.strokeStyle = RENDER_PALETTE.hairline;
        context.lineWidth = 1;
        context.beginPath();
        context.roundRect(centreX - width / 2, centreY - height / 2, width, height, READOUT_CORNER_RADIUS);
        context.fill();
        context.stroke();

        context.fillStyle = RENDER_PALETTE.inkPrimary;
        lines.forEach((line, index) => {
            const offset = (index - (lines.length - 1) / 2) * READOUT_LINE_HEIGHT_PX;
            context.fillText(line, centreX, centreY + offset);
        });
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

/** Where a mark's name is written, and which way it runs. */
interface LabelPlacement {
    readonly x: number;
    readonly y: number;
    readonly angle: number;
    readonly align: CanvasTextAlign;
}

interface DrawingStroke {
    readonly paint: PaintContext;
    readonly drawing: Drawing;
    /** Drawn heavier, with its anchors gripped. */
    readonly isSelected: boolean;
    /** Set while a mark is still being dragged out, so it reads as provisional. */
    readonly dash?: readonly number[];
}

/** Where a measurement's arrow runs, once its prices are on the surface. */
interface MeasuredSpan {
    readonly x: number;
    readonly fromY: number;
    readonly toY: number;
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
    return request.drawings.settled.filter((drawing) => (
        drawing.venue === request.dataset.venue
        && drawing.instrumentSymbol === request.dataset.instrumentSymbol
    ));
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
    const look = resolveDrawingLook(drawing);
    return `${drawing.id}@${drawing.tone}@${look.width}@${look.style}`
        + `@${resolveDrawingLabel(drawing) ?? ''}@${anchors}`;
}

/**
 * Names one retracement, as the proportion of the move it stands at.
 *
 * @param ratio - The retracement, as a fraction of the move.
 * @returns The label, without a trailing zero nobody reads.
 */
function formatRatio(ratio: number): string {
    // A whole percentage keeps its own width: 50% beside 61.8% reads as a list
    // of levels rather than as two different kinds of number.
    return `${(ratio * 100).toFixed(Number.isInteger(ratio * 100) ? 0 : 1)}%`;
}
