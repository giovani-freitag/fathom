import type { Drawing } from '../../shared/core/drawing.ts';
import { priceAtTime } from '../../shared/core/drawing.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';

/** How near the pointer has to be, in CSS pixels, to land on a mark. */
export const DRAWING_GRAB_TOLERANCE_PX = 6;

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
    const atMs = projector.xToTime(point.x);

    let nearestId: string | null = null;
    let nearestDistance = DRAWING_GRAB_TOLERANCE_PX;

    // Latest first, so a mark drawn over another is the one that gets grabbed.
    for (let index = drawings.length - 1; index >= 0; index -= 1) {
        const drawing = drawings[index]!;
        const distance = measureDistance({ drawing, atMs, y: point.y, projector });
        if (distance !== null && distance < nearestDistance) {
            nearestDistance = distance;
            nearestId = drawing.id;
        }
    }
    return nearestId;
}

interface DistanceRequest {
    readonly drawing: Drawing;
    readonly atMs: number;
    readonly y: number;
    readonly projector: ViewportProjector;
}

/**
 * How far the pointer is from a mark, vertically, in pixels.
 *
 * @returns The distance, or null when the mark does not reach that instant.
 */
function measureDistance(request: DistanceRequest): number | null {
    const { drawing, atMs } = request;
    if (!coversInstant(drawing, atMs)) {
        return null;
    }
    const price = priceAtTime(drawing, atMs);
    if (price === null) {
        return null;
    }
    return Math.abs(request.projector.priceToY(price) - request.y);
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
