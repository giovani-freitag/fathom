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
export type DrawingKind = 'horizontal-line' | 'trend-line' | 'zone' | 'fibonacci' | 'measure';

/** Every kind, in the order the dock offers them. */
export const DRAWING_KINDS: readonly DrawingKind[] = [
    'horizontal-line',
    'trend-line',
    'zone',
    'fibonacci',
    'measure',
];

/** Anchors each kind is pinned by. */
export const ANCHORS_PER_KIND: Readonly<Record<DrawingKind, number>> = {
    'horizontal-line': 1,
    'trend-line': 2,
    zone: 2,
    fibonacci: 2,
    measure: 2,
};

/**
 * Kinds that cover ground rather than trace a path.
 *
 * A box has no one price at an instant, so asking it for one would answer with
 * a diagonal nobody drew.
 */
const BOXED_KINDS: ReadonlySet<DrawingKind> = new Set<DrawingKind>([
    'zone',
    'fibonacci',
    'measure',
]);

/**
 * Whether a mark is read and then done with rather than kept.
 *
 * A measurement answers a question the reader had while they were looking; kept,
 * it would be one more thing to tidy up after every time they asked.
 *
 * @param kind - The kind to ask about.
 * @returns True when a mark of that kind is never stored.
 */
export function isTransientKind(kind: DrawingKind): boolean {
    return kind === 'measure';
}

/** How heavy a mark is drawn. */
export type DrawingWidth = 'thin' | 'medium' | 'thick';

/** How a mark's line is broken up, if at all. */
export type DrawingStyle = 'solid' | 'dashed' | 'dotted';

export const DRAWING_WIDTHS: readonly DrawingWidth[] = ['thin', 'medium', 'thick'];
export const DRAWING_STYLES: readonly DrawingStyle[] = ['solid', 'dashed', 'dotted'];

/** What a mark looks like, once the ones it did not say are filled in. */
export interface DrawingLook {
    readonly width: DrawingWidth;
    readonly style: DrawingStyle;
}

const DEFAULT_LOOK: DrawingLook = { width: 'medium', style: 'solid' };

/**
 * How a mark should be drawn, whatever it happens to say about itself.
 *
 * Read through here rather than off the mark, because a mark stored before this
 * build says nothing about either and has to be drawn anyway.
 *
 * @param drawing - The mark to look at.
 * @returns Its weight and its line, always both.
 */
export function resolveDrawingLook(drawing: Drawing): DrawingLook {
    return {
        width: DRAWING_WIDTHS.includes(drawing.width as DrawingWidth)
            ? drawing.width as DrawingWidth
            : DEFAULT_LOOK.width,
        style: DRAWING_STYLES.includes(drawing.style as DrawingStyle)
            ? drawing.style as DrawingStyle
            : DEFAULT_LOOK.style,
    };
}

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
    /** Absent on a mark stored before this build knew how to vary either. */
    readonly width?: DrawingWidth;
    readonly style?: DrawingStyle;
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
    if (BOXED_KINDS.has(drawing.kind)) {
        return null;
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
 * The corners of a mark, whichever way round it was dragged out.
 *
 * @param drawing - The mark to bound.
 * @returns The box it occupies, or null when it has no two anchors.
 */
export function boundDrawing(drawing: Drawing): DrawingBounds | null {
    const [first, second] = drawing.anchors;
    if (first === undefined || second === undefined) {
        return null;
    }
    return {
        fromMs: Math.min(first.atMs, second.atMs),
        toMs: Math.max(first.atMs, second.atMs),
        lowPrice: Math.min(first.price, second.price),
        highPrice: Math.max(first.price, second.price),
    };
}

export interface DrawingBounds {
    readonly fromMs: number;
    readonly toMs: number;
    readonly lowPrice: number;
    readonly highPrice: number;
}

/**
 * Moves one end of a mark, leaving the rest of it where it was.
 *
 * @param drawing - The mark to reshape.
 * @param index - Which anchor is being dragged.
 * @param anchor - Where that anchor is now.
 * @returns The reshaped mark, or the same one when there is no such anchor.
 */
export function moveDrawingAnchor(
    drawing: Drawing,
    index: number,
    anchor: DrawingAnchor,
): Drawing {
    if (drawing.anchors[index] === undefined) {
        return drawing;
    }
    return {
        ...drawing,
        anchors: drawing.anchors.map((existing, at) => {
            if (at !== index) {
                return existing;
            }
            // A level is read against the price axis alone, so the instant it
            // was pinned at is not something a drag of it should rewrite.
            return drawing.kind === 'horizontal-line'
                ? { atMs: existing.atMs, price: anchor.price }
                : anchor;
        }),
    };
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

/**
 * The retracements a reader reads a move against.
 *
 * The conventional set, and conventional is the point: the levels are only
 * useful because everybody draws the same ones, so this is not a place to have
 * an opinion. Nought and one are included because the ends of the move are two
 * of the levels a reader watches.
 */
export const FIBONACCI_RATIOS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
