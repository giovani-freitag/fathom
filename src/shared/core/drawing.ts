import type { PlotTone } from './draw-plan.ts';

/**
 * Where a drawing is pinned, in the chart's own coordinates.
 *
 * Time and price rather than pixels: a mark pinned to the surface would slide
 * off what it was drawn about the moment the reader panned.
 */
export interface DrawingAnchor {
    readonly atMs: number;
    readonly price: number;
}

/** The kinds of mark a reader can leave on the chart. */
export type DrawingKind = 'horizontal-line' | 'trend-line';

/** Every kind, in the order the toolbar offers them. */
export const DRAWING_KINDS: readonly DrawingKind[] = ['horizontal-line', 'trend-line'];

/** Anchors each kind is pinned by. */
export const ANCHORS_PER_KIND: Readonly<Record<DrawingKind, number>> = {
    'horizontal-line': 1,
    'trend-line': 2,
};

/**
 * One mark a reader left on one instrument's chart.
 */
export interface Drawing {
    readonly id: string;
    readonly kind: DrawingKind;
    /** The contract it was drawn about; it is shown on no other. */
    readonly instrumentSymbol: string;
    readonly anchors: readonly DrawingAnchor[];
    readonly tone: PlotTone;
}

/**
 * Whether a value can be read as an anchor.
 *
 * @param candidate - Whatever came out of storage.
 * @returns True when both coordinates are finite numbers.
 */
function isAnchor(candidate: unknown): candidate is DrawingAnchor {
    const anchor = candidate as Partial<DrawingAnchor> | null;
    return typeof anchor?.atMs === 'number' && Number.isFinite(anchor.atMs)
        && typeof anchor.price === 'number' && Number.isFinite(anchor.price);
}

/**
 * Whether a value read back from storage is a drawing this build can draw.
 *
 * @param candidate - Whatever came out of storage.
 * @returns True when it names a known kind and carries the anchors that kind needs.
 */
export function isDrawing(candidate: unknown): candidate is Drawing {
    const drawing = candidate as Partial<Drawing> | null;
    if (typeof drawing?.id !== 'string' || typeof drawing.instrumentSymbol !== 'string') {
        return false;
    }
    // The table is what this build can place. A kind missing from it is a mark
    // it cannot draw: kept, it would be persisted for ever and shown by nothing.
    if (!Object.hasOwn(ANCHORS_PER_KIND, drawing.kind as DrawingKind)) {
        return false;
    }

    const anchors: unknown = drawing.anchors;
    return Array.isArray(anchors)
        && anchors.length === ANCHORS_PER_KIND[drawing.kind as DrawingKind]
        && anchors.every(isAnchor);
}

/**
 * The price a drawing sits at, at one instant.
 *
 * @param drawing - The mark to read.
 * @param atMs - The instant to read it at.
 * @returns The price, or null when the drawing has no anchors to read.
 */
export function priceAtTime(drawing: Drawing, atMs: number): number | null {
    const [first, second] = drawing.anchors;
    if (first === undefined) {
        return null;
    }
    if (second === undefined) {
        return first.price;
    }

    // Extrapolated past both ends on purpose: a trend line is read for where it
    // says price is going, which is beyond the two points that set it.
    const spanMs = second.atMs - first.atMs;
    if (spanMs === 0) {
        return second.price;
    }
    return first.price + ((atMs - first.atMs) / spanMs) * (second.price - first.price);
}

export interface DrawingShift {
    readonly deltaMs: number;
    readonly deltaPrice: number;
}

/**
 * Moves a whole drawing, keeping its shape.
 *
 * @param drawing - The mark to move.
 * @param shift - How far to move it, in chart coordinates.
 * @returns The moved mark.
 */
export function shiftDrawing(drawing: Drawing, shift: DrawingShift): Drawing {
    return {
        ...drawing,
        anchors: drawing.anchors.map((anchor) => ({
            // A level is read against the price axis alone, so sliding it along
            // time would move nothing a reader can see while losing where it
            // was pinned.
            atMs: drawing.kind === 'horizontal-line' ? anchor.atMs : anchor.atMs + shift.deltaMs,
            price: anchor.price + shift.deltaPrice,
        })),
    };
}
