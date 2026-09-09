import type { TagColour } from './pair-tags.ts';

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
export type DrawingKind =
    | 'horizontal-line'
    | 'trend-line'
    | 'zone'
    | 'fibonacci'
    | 'measure'
    | 'freehand'
    | 'highlighter'
    | 'emoji'
    | 'laser';

/**
 * Every kind, in the order the dock offers them.
 *
 * The drawing tools first, then the ones that only point: a laser and a
 * measurement leave nothing behind, and an emoji is somebody else's artwork
 * rather than a stroke. The emoji sits last of all because its button is the
 * one that opens a catalogue, and a control that opens onto everything belongs
 * at the end of a row rather than in the middle of the strokes.
 */
export const DRAWING_KINDS: readonly DrawingKind[] = [
    'horizontal-line',
    'trend-line',
    'zone',
    'fibonacci',
    'freehand',
    'highlighter',
    'measure',
    'laser',
    'emoji',
];

/** Anchors each kind is pinned by. */
export const ANCHORS_PER_KIND: Readonly<Record<DrawingKind, number>> = {
    'horizontal-line': 1,
    'trend-line': 2,
    zone: 2,
    fibonacci: 2,
    measure: 2,
    // One to start on. A path grows for as long as the hand moves, so this
    // is the fewest it can have rather than the number it will end with.
    freehand: 1,
    highlighter: 1,
    emoji: 1,
    laser: 1,
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
 * Kinds whose anchors are a path the hand drew rather than its ends.
 *
 * Every other kind knows how many anchors it has before the reader starts. A
 * path knows only that it has at least one, so the count in the table above is
 * a floor for these and an exact number for the rest.
 */
const PATH_KINDS: ReadonlySet<DrawingKind> = new Set<DrawingKind>([
    'freehand',
    'highlighter',
    'laser',
]);

/**
 * Whether a kind is drawn by dragging a path rather than by placing ends.
 *
 * @param kind - The kind to ask about.
 * @returns True when its anchors are however many the hand left behind.
 */
export function isPathKind(kind: DrawingKind): boolean {
    return PATH_KINDS.has(kind);
}

/**
 * The most anchors one path keeps.
 *
 * A stroke across a wide chart is thousands of moves, and every one of them
 * would be stored, sent to the painter and walked by the hit test on every
 * frame. Past this the path stops growing rather than the mark being refused:
 * a reader mid-stroke has not made a mistake.
 */
export const MOST_PATH_ANCHORS = 512;

/**
 * The marks the picker offers before it has read the full catalogue.
 *
 * The verdicts a chart is actually annotated with — watch this, it held, it
 * broke, I was wrong — so a reader who opens the tool and places one has
 * waited for nothing. Everything else arrives with the catalogue.
 */
export const EMOJI_GLYPHS: readonly string[] = [
    '\u{1F440}', '\u{2757}', '\u{2705}', '\u{274C}', '\u{1F525}',
    '\u{1F9F1}', '\u{1F4A1}', '\u{1F4A5}', '\u{1F3AF}', '\u{1F914}',
];

/** The most recently placed emoji a reader is offered again. */
export const MOST_RECENT_GLYPHS = 24;

/**
 * The most UTF-16 units one glyph may be.
 *
 * An emoji is not one character: a face with a skin tone is two code points
 * and a flag is two more, so this is counted in the units a string is made
 * of rather than in anything a reader would call a letter.
 */
export const MAXIMUM_GLYPH_LENGTH = 16;

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
    return kind === 'measure' || kind === 'laser';
}

/**
 * Whether a path keeps only its own tail as the hand moves on.
 *
 * A pen keeps the whole stroke, because the stroke is the point of it. A
 * laser is where the hand is now and where it just was, so it drops its
 * oldest points rather than growing: the trail is what makes a sweep read
 * as a sweep, and a trail that never ends is a line.
 *
 * @param kind - The kind to ask about.
 * @returns True when the oldest points fall off the back.
 */
export function isRollingKind(kind: DrawingKind): boolean {
    return kind === 'laser';
}

/** How far behind the hand a pointer's light is still lit. */
export type DrawingTrail = 'short' | 'medium' | 'long';

export const DRAWING_TRAILS: readonly DrawingTrail[] = ['short', 'medium', 'long'];

/**
 * How many points each trail keeps, which is far fewer than a stroke.
 *
 * Long enough to show which way the hand went, short enough that it reads as
 * a pointer and not as something drawn. Which of the three a reader wants
 * depends on what they are pointing at: a dot follows the hand around one
 * price, and a long tail draws the path a move took across the screen.
 */
export const TRAIL_ANCHORS: Readonly<Record<DrawingTrail, number>> = {
    short: 16,
    medium: 48,
    long: 120,
};

const DEFAULT_TRAIL: DrawingTrail = 'medium';

/**
 * How long a mark's trail runs, whatever it happens to say about itself.
 *
 * @param drawing - The mark being drawn out.
 * @returns The points its tail keeps.
 */
export function resolveTrailAnchors(drawing: Drawing): number {
    return TRAIL_ANCHORS[DRAWING_TRAILS.includes(drawing.trail as DrawingTrail)
        ? drawing.trail as DrawingTrail
        : DEFAULT_TRAIL];
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
 * Which of the look controls a kind actually answers to.
 *
 * Read against what the painter does rather than assumed, because a control
 * that changes nothing is worse than a missing one: it tells a reader they
 * have a choice, takes their answer, and draws what it was going to anyway.
 *
 * Weight is the one every kind uses, an emoji included — the size its glyph is
 * set in is read out of it.
 */
export interface DrawingFields {
    /** An emoji is picked, and what it is picked from is a catalogue. */
    readonly hasGlyph: boolean;
    readonly hasTone: boolean;
    readonly hasStyle: boolean;
    /** A mark nobody keeps cannot carry a name to be read later. */
    readonly hasLabel: boolean;
    /** Only a pointer has a tail, because only a pointer drops its own points. */
    readonly hasTrail: boolean;
}

/**
 * Kinds the painter will actually break the line of.
 *
 * The rest each overrule it. A highlighter that was dashed would cover half of
 * what it was drawn over and a trail is lit rather than drawn, so both are
 * forced solid; retracements set their own dash per ratio, so the whole ladder
 * would look the same whatever was asked for; and an emoji has no line at all.
 */
const STYLED_KINDS: ReadonlySet<DrawingKind> = new Set<DrawingKind>([
    'horizontal-line',
    'trend-line',
    'zone',
    'measure',
    'freehand',
]);

/**
 * Kinds whose colour is not the reader's to choose.
 *
 * A measurement is coloured by which way it was dragged, because whether the
 * move it spans is up or down is the first thing read off it. An emoji comes
 * with its own colours and paints over any that were asked for.
 */
const TONELESS_KINDS: ReadonlySet<DrawingKind> = new Set<DrawingKind>([
    'emoji',
    'measure',
]);

/**
 * The look controls one kind offers.
 *
 * @param kind - The kind being set up or restyled.
 * @returns Which controls apply to it; weight applies to every kind.
 */
export function readDrawingFields(kind: DrawingKind): DrawingFields {
    return {
        hasGlyph: kind === 'emoji',
        hasTone: !TONELESS_KINDS.has(kind),
        hasStyle: STYLED_KINDS.has(kind),
        hasLabel: !isTransientKind(kind),
        hasTrail: isRollingKind(kind),
    };
}

/**
 * How long a mark's name may be.
 *
 * Long enough for a reason and short enough to sit beside the mark rather than
 * across the chart: a label wider than what it names has stopped labelling it.
 */
export const MAXIMUM_LABEL_LENGTH = 60;

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
 * A mark's name exactly as it is stored, for a field being typed into.
 *
 * Untrimmed on purpose: a field that trims what is being typed takes the space
 * back off the moment it is pressed, and the second word is never reachable.
 *
 * Read through here rather than off the mark, because storage is a place a
 * string can arrive from having been something else: a name that is not text is
 * a name nobody typed, and drawing it would put `[object Object]` on the chart.
 *
 * @param drawing - The mark to read.
 * @returns Its name as stored and bounded, or the empty string when it has none.
 */
export function readStoredLabel(drawing: Drawing): string {
    return typeof drawing.label === 'string'
        ? drawing.label.slice(0, MAXIMUM_LABEL_LENGTH)
        : '';
}

/**
 * What a mark is called, or nothing when it was never named.
 *
 * @param drawing - The mark to read.
 * @returns Its name, ready to write on the chart, or null when it has none.
 */
export function resolveDrawingLabel(drawing: Drawing): string | null {
    const label = readStoredLabel(drawing).trim();
    return label === '' ? null : label;
}

/**
 * One mark a reader left on one instrument's chart.
 */
export interface Drawing {
    readonly id: string;
    readonly kind: DrawingKind;
    /**
     * The contract it was drawn about; it is shown on no other.
     *
     * Both halves, because two venues list one symbol and quote it at different
     * prices: a line placed against one of them crosses nothing on the other.
     */
    readonly venue: string;
    readonly instrumentSymbol: string;
    readonly anchors: readonly DrawingAnchor[];
    /**
     * What the mark is drawn in: one of the chart's own, or any a reader named.
     *
     * The same vocabulary a tag is coloured in, so one control offers both and
     * a reader who has run out of the chart's five has not run out of colours.
     */
    readonly tone: TagColour;
    /** Absent on a mark stored before this build knew how to vary either. */
    readonly width?: DrawingWidth;
    readonly style?: DrawingStyle;
    /**
     * What the reader called it, written on the chart beside it.
     *
     * A mark says where; a name says why, and why is the half a reader cannot
     * reconstruct a week later from a line on a screen.
     */
    readonly label?: string;
    /**
     * The mark an emoji draws, absent on every kind that draws its own shape.
     *
     * Stored rather than derived, because it is the whole of what the reader
     * chose: two emoji marks on one chart differ in nothing else.
     */
    readonly glyph?: string;
    /**
     * How far behind the hand a pointer's light stays lit.
     *
     * Only a laser has one, and a laser is never stored, so this lives for as
     * long as the stroke does and no longer.
     */
    readonly trail?: DrawingTrail;
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

    // A glyph is the reader's own text on their own chart, so it is bounded
    // rather than trusted: a stored string of any length would be drawn.
    const glyph: unknown = drawing.glyph;
    if (glyph !== undefined && (typeof glyph !== 'string' || glyph.length > MAXIMUM_GLYPH_LENGTH)) {
        return false;
    }

    const anchors: unknown = drawing.anchors;
    if (!Array.isArray(anchors) || !anchors.every(isAnchor)) {
        return false;
    }
    // A count for the kinds that know theirs, a floor for a path: read as an
    // exact number, every stroke a reader had drawn would fail to load.
    const wanted = ANCHORS_PER_KIND[drawing.kind as DrawingKind];
    return isPathKind(drawing.kind as DrawingKind)
        ? anchors.length >= wanted
        : anchors.length === wanted;
}

/**
 * The mark an emoji drawing shows.
 *
 * @param drawing - The mark to read.
 * @returns Its glyph, or the first the tool offers where it named none.
 */
export function readStoredGlyph(drawing: Drawing): string {
    const glyph = drawing.glyph;
    return glyph === undefined || glyph === '' ? EMOJI_GLYPHS[0]! : glyph;
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
