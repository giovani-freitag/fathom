import { boundDrawing, type Drawing, type DrawingAnchor, isPathKind, priceAtTime } from '../../shared/core/drawing.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';

/**
 * How near the pointer has to be, in CSS pixels, to land on a mark.
 *
 * Sized for a fingertip rather than a mouse: a line one pixel wide is not
 * something anybody hits on a phone, and a tap that misses pans the chart.
 */
export const DRAWING_GRAB_TOLERANCE_PX = 14;

/**
 * How near the pointer has to be to land on one end of a mark rather than on
 * the mark itself.
 *
 * Wider than the grip is drawn, for the same reason the line's own tolerance is
 * wider than the line: what is aimed at is a dot, and a thumb covers it.
 */
export const DRAWING_ANCHOR_TOLERANCE_PX = 12;

export interface DrawingHitRequest {
    readonly drawings: readonly Drawing[];
    readonly projector: ViewportProjector;
    /** Where the pointer is, in surface pixels. */
    readonly point: { readonly x: number; readonly y: number };
}

/**
 * The mark under the pointer, if any.
 *
 * @param request - What is drawn, where the pointer is, and how to project it.
 * @returns The id of the nearest mark within grabbing distance, or null.
 */
export function findDrawingAt(request: DrawingHitRequest): string | null {
    const { drawings, projector, point } = request;

    let nearestId: string | null = null;
    let nearestDistance = DRAWING_GRAB_TOLERANCE_PX;

    // Latest first, so a mark drawn over another is the one that gets grabbed.
    for (let index = drawings.length - 1; index >= 0; index -= 1) {
        const drawing = drawings[index]!;
        const distance = measureDistance({ drawing, point, projector });
        if (distance !== null && distance < nearestDistance) {
            nearestDistance = distance;
            nearestId = drawing.id;
        }
    }
    return nearestId;
}

export interface DrawingAnchorHitRequest {
    readonly drawing: Drawing;
    readonly projector: ViewportProjector;
    readonly point: { readonly x: number; readonly y: number };
}

/**
 * Which end of a mark the pointer is on, if any.
 *
 * Only the selected mark has ends to grab: they are the grips the painter draws
 * for it, and grabbing one on a mark nobody can see the grips of would reshape
 * a line by what looks like a press on it.
 *
 * @param request - The mark, where the pointer is, and how to project it.
 * @returns The index of the anchor under the pointer, or null.
 */
export function findAnchorAt(request: DrawingAnchorHitRequest): number | null {
    const { drawing, projector, point } = request;

    let nearestIndex: number | null = null;
    let nearestDistance = DRAWING_ANCHOR_TOLERANCE_PX;

    drawing.anchors.forEach((anchor, index) => {
        const distance = Math.hypot(anchorX(drawing, anchor, projector) - point.x,
            projector.priceToY(anchor.price) - point.y);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
        }
    });
    return nearestIndex;
}

/**
 * Where a mark's grip is drawn, which is not always where its anchor is.
 */
function anchorX(drawing: Drawing, anchor: DrawingAnchor, projector: ViewportProjector): number {
    // A level is pinned to a price and drawn across the whole window, so its
    // grip sits where a reader can reach it rather than at an instant that may
    // be off screen. The painter places it there; this has to agree.
    return drawing.kind === 'horizontal-line'
        ? projector.plotWidth / 2
        : projector.timeToX(anchor.atMs);
}

interface DistanceRequest {
    readonly drawing: Drawing;
    readonly point: { readonly x: number; readonly y: number };
    readonly projector: ViewportProjector;
}

/**
 * How far the pointer is from a mark, in pixels.
 *
 * @returns The distance, or null when the mark is not drawn there at all.
 */
function measureDistance(request: DistanceRequest): number | null {
    // A path doubles back on itself, so there is no one price at an instant to
    // measure against: the nearest of its own segments is the answer.
    if (isPathKind(request.drawing.kind)) {
        return measurePathDistance(request);
    }
    // A glyph is a mark at one place rather than a line across the window,
    // so it is reached from any side: measured the way a level is, a press
    // level with it anywhere along the chart would grab it.
    if (request.drawing.kind === 'emoji') {
        return measureAnchorDistance(request);
    }
    // A retracement is a stack of lines across the window; grabbing the band
    // they span is how a thumb reaches one at all.
    return request.drawing.kind === 'zone' || request.drawing.kind === 'fibonacci'
        ? measureZoneDistance(request)
        : measureLineDistance(request);
}

/**
 * How far the pointer is from the one place a mark is pinned to.
 *
 * @returns The distance, or null when the mark is pinned to nothing.
 */
function measureAnchorDistance(request: DistanceRequest): number | null {
    const [anchor] = request.drawing.anchors;
    if (anchor === undefined) {
        return null;
    }
    return Math.hypot(
        request.point.x - request.projector.timeToX(anchor.atMs),
        request.point.y - request.projector.priceToY(anchor.price),
    );
}

/**
 * How far the pointer is from the nearest piece of a path.
 *
 * @returns The distance, or null when the path has no piece to be near.
 */
function measurePathDistance(request: DistanceRequest): number | null {
    const { drawing, point, projector } = request;
    const points = drawing.anchors.map((anchor) => ({
        x: projector.timeToX(anchor.atMs),
        y: projector.priceToY(anchor.price),
    }));

    let nearest: number | null = null;
    for (let index = 1; index < points.length; index += 1) {
        const gap = distanceToSegment(point, points[index - 1]!, points[index]!);
        if (nearest === null || gap < nearest) {
            nearest = gap;
        }
    }
    return nearest;
}

/**
 * How far a point lies from a segment, rather than from the line through it.
 *
 * Measured to the segment because a stroke is made of many: the line through
 * one piece runs off across the whole plot, and every piece would claim a
 * pointer anywhere along it.
 */
function distanceToSegment(
    point: { readonly x: number; readonly y: number },
    from: { readonly x: number; readonly y: number },
    to: { readonly x: number; readonly y: number },
): number {
    const runX = to.x - from.x;
    const runY = to.y - from.y;
    const lengthSquared = runX * runX + runY * runY;
    if (lengthSquared === 0) {
        return Math.hypot(point.x - from.x, point.y - from.y);
    }

    const along = Math.min(1, Math.max(0, (
        (point.x - from.x) * runX + (point.y - from.y) * runY
    ) / lengthSquared));
    return Math.hypot(point.x - (from.x + along * runX), point.y - (from.y + along * runY));
}

/**
 * How far the pointer is from a level or a segment, vertically.
 */
function measureLineDistance(request: DistanceRequest): number | null {
    const { drawing, point, projector } = request;
    const atMs = projector.xToTime(point.x);
    if (!coversInstant(drawing, atMs)) {
        return null;
    }

    const price = priceAtTime(drawing, atMs);
    return price === null ? null : Math.abs(projector.priceToY(price) - point.y);
}

/**
 * How far the pointer is from a zone, counting anywhere inside it as on it.
 *
 * A trading zone is read as an area, and hunting for its one-pixel outline with
 * a fingertip is not something anybody should have to do.
 */
function measureZoneDistance(request: DistanceRequest): number | null {
    const bounds = boundDrawing(request.drawing);
    if (bounds === null) {
        return null;
    }

    const { point, projector } = request;
    const left = projector.timeToX(bounds.fromMs);
    const right = projector.timeToX(bounds.toMs);
    const top = projector.priceToY(bounds.highPrice);
    const bottom = projector.priceToY(bounds.lowPrice);

    return Math.hypot(
        Math.max(left - point.x, 0, point.x - right),
        Math.max(top - point.y, 0, point.y - bottom),
    );
}

/**
 * Whether a mark is drawn at an instant at all.
 *
 * A level spans every instant; a segment stops at the points that set it, and
 * grabbing it beyond them would grab a line nobody can see there.
 */
function coversInstant(drawing: Drawing, atMs: number): boolean {
    const [first, second] = drawing.anchors;
    if (first === undefined || second === undefined) {
        return true;
    }
    return atMs >= Math.min(first.atMs, second.atMs) && atMs <= Math.max(first.atMs, second.atMs);
}
