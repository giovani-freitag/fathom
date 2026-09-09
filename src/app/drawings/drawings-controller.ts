import {
    ANCHORS_PER_KIND,
    type Drawing,
    type DrawingAnchor,
    type DrawingKind,
    type DrawingStyle,
    type DrawingWidth,
    EMOJI_GLYPHS,
    isPathKind,
    isRollingKind,
    LASER_TRAIL_ANCHORS,
    isTransientKind,
    MOST_PATH_ANCHORS,
    MOST_RECENT_GLYPHS,
    moveDrawingAnchor,
    readDrawingFields,
    readStoredGlyph,
    shiftDrawing,
} from '../../shared/core/drawing.ts';
import { INSTANCE_TONES } from '../../shared/core/draw-plan.ts';
import type { TagColour } from '../../shared/core/pair-tags.ts';
import { DrawingHistory } from './drawing-history.ts';
import { ObservableStore } from '../core/observable-store.ts';
import type { PreferencesService } from '../services/preferences-service.ts';
import type { MarketPair } from '../../shared/core/pair-tags.ts';

/** What a tool holds before a reader has told it anything. */
const OPENING_PENDING: PendingLook = {
    tone: null,
    width: 'medium',
    style: 'solid',
    glyph: EMOJI_GLYPHS[0]!,
    label: '',
};

/** Marks one chart may hold, past which the oldest is forgotten. */
export const MAXIMUM_DRAWINGS_PER_INSTRUMENT = 64;

/**
 * What the reader has drawn, and what they are drawing now.
 */
export interface DrawingsState {
    /** The tool the next press will draw with, or null while the pointer selects. */
    readonly armedTool: DrawingKind | null;
    /**
     * Whether the armed tool survives the mark it just drew.
     *
     * Off, a tool is put down after one use, which is right for the reader who
     * came to draw one thing. On, it stays: marking six levels is six presses
     * on the chart rather than six round trips to the toolbar.
     */
    readonly isToolLocked: boolean;
    readonly drawings: readonly Drawing[];
    readonly selectedId: string | null;
    /** The mark being dragged out, drawn but not yet kept. */
    readonly draft: Drawing | null;
    /** What the next mark will look like, as the reader has set it up. */
    readonly pending: PendingLook;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /** The emoji this reader pins, newest first, for the picker to offer first. */
    readonly recentGlyphs: readonly string[];
}

/**
 * The look a tool is holding, before anything has been drawn with it.
 *
 * A laser is never on the chart to be selected — it is gone by the time the
 * hand stops — so the only moment its colour and weight can be set is before
 * the stroke. What is true of the laser is true of every tool: a reader who
 * knows they want a red level should say so once, not draw a level and correct
 * it.
 */
export interface PendingLook {
    /**
     * The tone every new mark takes, or null while it still cycles.
     *
     * Null until a reader picks one, because two crossing lines in the same
     * colour are one line as far as a reader can tell. Once they have picked,
     * the pick stands: they asked for that colour, not for a rotation.
     */
    readonly tone: TagColour | null;
    readonly width: DrawingWidth;
    readonly style: DrawingStyle;
    /** What the next emoji shows, which is whichever one was placed last. */
    readonly glyph: string;
    /**
     * What the next mark will be called, typed before it exists.
     *
     * Asked for up front so that marking a level a reader already has a reason
     * for is one press rather than a press and then a field: they arrive
     * knowing what it is, and the tool should be able to take that.
     */
    readonly label: string;
}

/** What about a mark is being changed. */
export interface DrawingRestyle {
    readonly tone?: TagColour;
    readonly width?: DrawingWidth;
    readonly style?: DrawingStyle;
    /** What the reader calls it; an empty name takes the label off. */
    readonly label?: string;
    /** The mark an emoji shows; every later one the reader places takes it too. */
    readonly glyph?: string;
}

/** Where a press landed, and on what. */
export interface DrawingPress {
    readonly anchor: DrawingAnchor;
    /** The mark under the pointer, or null when the press landed on bare chart. */
    readonly hitId: string | null;
    /**
     * Which end of that mark was grabbed, or null for the mark as a whole.
     *
     * A drag of one end reshapes; a drag of anywhere else moves. Which of the
     * two a press meant is decided where the grips are drawn, not here.
     */
    readonly grabbedAnchorIndex?: number | null;
}

export interface DrawingsControllerConfig {
    readonly preferences: PreferencesService;
    /** The contract on the chart, which a new mark is drawn about. */
    readonly readContract: () => MarketPair | null;
    /** Names a new mark; injected so a test can read what was made. */
    readonly newId: () => string;
}

/**
 * The marks a reader leaves on the chart, and the gesture that makes one.
 */
export class DrawingsController {
    readonly store: ObservableStore<DrawingsState>;

    private readonly config: DrawingsControllerConfig;
    private readonly history = new DrawingHistory();
    /** Where the pointer went down, for a move measured against its start. */
    private grabbedFrom: DrawingAnchor | null = null;
    /** True while a draft has one end and is waiting for a press to place the other. */
    private isAwaitingSecondAnchor = false;
    /** Which end the gesture has hold of, or null when it has the whole mark. */
    private grabbedAnchorIndex: number | null = null;

    /** The mark whose name is being typed, so the letters make one step. */
    private renamingId: string | null = null;
    /**
     * What was on the chart when the gesture began.
     *
     * Held rather than recorded per move: a drag rewrites a mark many times a
     * second, and a step back per frame is not a step a reader can use.
     */
    private beforeGesture: readonly Drawing[] | null = null;

    constructor(config: DrawingsControllerConfig) {
        this.config = config;
        const recent = config.preferences.read().recentGlyphs;
        this.store = new ObservableStore<DrawingsState>({
            initialState: {
                armedTool: null,
                isToolLocked: false,
                drawings: config.preferences.read().drawings,
                selectedId: null,
                draft: null,
                pending: { ...OPENING_PENDING, glyph: openingGlyph(recent) },
                canUndo: false,
                canRedo: false,
                recentGlyphs: recent,
            },
        });
    }

    /**
     * Arms a tool for the next press, or hands the pointer back to selection.
     *
     * @param armedTool - The kind to draw next, or null to select instead.
     */
    arm(armedTool: DrawingKind | null): void {
        // Reaching for a tool lets go of whatever was held. They are the same
        // question — what am I working on — and the panel can only answer it
        // once: leaving the selection up showed the last mark's settings to a
        // reader who had just said they were about to draw a new one.
        this.store.update((state) => ({ ...state, armedTool, draft: null, selectedId: null }));
    }

    /**
     * Keeps the armed tool after it has drawn, or hands it back.
     *
     * @param isToolLocked - Whether a tool stays armed once it has been used.
     */
    lockTool(isToolLocked: boolean): void {
        this.store.update((state) => ({ ...state, isToolLocked }));
    }

    /**
     * Starts whatever a press begins: a new mark, a move, or a selection.
     *
     * @param press - Where the pointer went down, and on what.
     */
    begin(press: DrawingPress): void {
        this.grabbedFrom = press.anchor;
        this.grabbedAnchorIndex = press.grabbedAnchorIndex ?? null;
        this.beforeGesture = this.store.read().drawings;

        // A draft left open by a press that did not drag is waiting for its
        // second anchor, and this press is it. Placing two ends with two
        // clicks is the idiom every chart a reader has used works by, and
        // before this one it did nothing at all — no first mark, no line
        // following the pointer, no error.
        const { armedTool, draft } = this.store.read();
        if (draft !== null && this.isAwaitingSecondAnchor) {
            this.isAwaitingSecondAnchor = false;
            this.reshapeDraft(press.anchor);
            this.commitDraft();
            return;
        }
        if (armedTool !== null) {
            this.isAwaitingSecondAnchor = false;
            this.startDraft(armedTool, press.anchor);
            return;
        }
        this.select(press.hitId);
    }

    /**
     * Follows the pointer while a draft waits for its second anchor.
     *
     * @param anchor - Where the pointer is now.
     */
    trace(anchor: DrawingAnchor): void {
        if (this.isAwaitingSecondAnchor) {
            this.reshapeDraft(anchor);
        }
    }

    /**
     * Keeps what a draft became, and puts the tool away.
     *
     * Kept selected, so the mark a reader just made is the one a press of
     * Delete removes without hunting for it again.
     */
    private commitDraft(): void {
        const { draft } = this.store.read();
        if (draft === null) {
            return;
        }
        if (isTransientKind(draft.kind)) {
            // Left on screen but never stored: it is read where it was drawn
            // and then done with, so it is neither persisted nor undoable.
            this.store.update((state) => ({ ...state, armedTool: disarm(state) }));
            return;
        }
        this.store.update((state) => ({
            ...state,
            armedTool: disarm(state),
            draft: null,
            selectedId: draft.id,
            drawings: keepNewest([...state.drawings, draft]),
            // Counted here rather than where one is picked, because picking is
            // browsing: a reader scrolling the catalogue has not used anything
            // until a mark of it is on the chart.
            recentGlyphs: draft.kind === 'emoji'
                ? withGlyphUsed(state.recentGlyphs, readStoredGlyph(draft))
                : state.recentGlyphs,
        }));
    }

    /**
     * Points the controls at one mark, or at none.
     *
     * @param drawingId - The mark to select, or null to select nothing.
     */
    select(drawingId: string | null): void {
        // Coming back to a mark starts a fresh name rather than extending the
        // step the last one was typed in.
        this.renamingId = null;
        // A measurement is answered by the moment it was asked in: the next
        // press anywhere is a reader who has read it and moved on.
        this.store.update((state) => ({ ...state, selectedId: drawingId, draft: null }));
    }

    /**
     * Carries the gesture: shapes the new mark, or moves the selected one.
     *
     * @param anchor - Where the pointer is now.
     */
    drag(anchor: DrawingAnchor): void {
        const from = this.grabbedFrom;
        if (from === null) {
            return;
        }
        this.grabbedFrom = anchor;

        const { draft } = this.store.read();
        if (draft !== null) {
            this.reshapeDraft(anchor);
            return;
        }
        if (this.grabbedAnchorIndex !== null) {
            this.reshapeSelected(this.grabbedAnchorIndex, anchor);
            return;
        }
        this.shiftSelected({ deltaMs: anchor.atMs - from.atMs, deltaPrice: anchor.price - from.price });
    }

    /**
     * Ends the gesture, keeping whatever it produced.
     */
    settle(): void {
        this.grabbedFrom = null;
        const before = this.beforeGesture;
        this.beforeGesture = null;
        const { draft } = this.store.read();
        if (draft !== null && isPathKind(draft.kind) && draft.anchors.length < 2) {
            // A press that never moved. Kept, it would be a dot nobody meant to
            // leave and nothing on the chart to grab it by.
            this.store.update((state) => ({ ...state, draft: null, armedTool: disarm(state) }));
            return;
        }
        if (draft !== null && !hasExtent(draft)) {
            // A press that did not drag, on a mark that needs two ends. Held
            // open rather than thrown away: it follows the pointer until the
            // next press says where its other end is.
            this.isAwaitingSecondAnchor = ANCHORS_PER_KIND[draft.kind] > 1;
            if (this.isAwaitingSecondAnchor) {
                return;
            }
            this.store.update((state) => ({ ...state, draft: null }));
            return;
        }
        if (draft !== null && isRollingKind(draft.kind)) {
            // Gone the moment the hand lifts, which is what a laser is: it is
            // lit while the button is held and dark after, so nothing lingers
            // for the reader to tidy up or wonder about.
            this.store.update((state) => ({ ...state, draft: null, armedTool: disarm(state) }));
            return;
        }
        if (draft !== null && isTransientKind(draft.kind)) {
            // Left on screen but never stored: it is read where it was drawn
            // and then done with, so it is neither persisted nor undoable.
            this.store.update((state) => ({ ...state, armedTool: disarm(state) }));
            return;
        }
        if (draft !== null) {
            this.commitDraft();
        }

        // Recorded only when the gesture actually changed something: a press
        // that merely selected is not a step anybody wants to undo.
        if (before !== null && before !== this.store.read().drawings) {
            this.rememberStep(before);
        }
        this.persist();
    }

    /**
     * Steps back one thing the reader did.
     */
    undo(): void {
        this.travel(this.history.undo(this.store.read().drawings));
    }

    /**
     * Steps forward one thing the reader undid.
     */
    redo(): void {
        this.travel(this.history.redo(this.store.read().drawings));
    }

    /**
     * Changes how the next mark will be drawn.
     *
     * Not history: nothing has been drawn yet, so there is no step for an undo
     * to take back. A reader who set up a red laser and pressed undo means the
     * stroke before it, not the colour they just chose.
     *
     * @param look - Whichever of its tone, weight, line and emoji to change.
     */
    restylePending(look: DrawingRestyle): void {
        this.store.update((state) => ({
            ...state,
            pending: {
                tone: look.tone ?? state.pending.tone,
                width: look.width ?? state.pending.width,
                style: look.style ?? state.pending.style,
                glyph: look.glyph === undefined || look.glyph === ''
                    ? state.pending.glyph
                    : look.glyph,
                label: look.label ?? state.pending.label,
            },
        }));
    }

    /**
     * Changes how one mark is drawn.
     *
     * @param drawingId - The mark to restyle.
     * @param look - Whichever of its tone, weight and line to change.
     */
    restyle(drawingId: string, look: DrawingRestyle): void {
        // A name is typed a letter at a time and meant a word at a time: a
        // reader who undoes one expects the name gone, not its last character.
        const isRenaming = look.label !== undefined && Object.keys(look).length === 1;
        if (!isRenaming || this.renamingId !== drawingId) {
            this.rememberStep(this.store.read().drawings);
        }
        this.renamingId = isRenaming ? drawingId : null;
        this.store.update((state) => ({
            ...state,
            // The emoji alone travels back to the tool. A reader who recolours
            // one level meant that level; a reader who swaps the face on one
            // mark has changed their mind about which face they are using.
            pending: look.glyph === undefined || look.glyph === ''
                ? state.pending
                : { ...state.pending, glyph: look.glyph },
            drawings: state.drawings.map(
                (drawing) => (drawing.id === drawingId ? { ...drawing, ...look } : drawing),
            ),
        }));
        this.persist();
    }

    /**
     * Takes one mark off the chart.
     *
     * @param drawingId - The mark to remove; unknown ids are ignored.
     */
    remove(drawingId: string): void {
        this.rememberStep(this.store.read().drawings);
        this.store.update((state) => ({
            ...state,
            drawings: state.drawings.filter((drawing) => drawing.id !== drawingId),
            selectedId: state.selectedId === drawingId ? null : state.selectedId,
        }));
        this.persist();
    }

    /**
     * Opens a draft of the armed kind, with every anchor on the press.
     */
    private startDraft(kind: DrawingKind, anchor: DrawingAnchor): void {
        const contract = this.config.readContract();
        if (contract === null) {
            return;
        }

        const { drawings: drawn, pending } = this.store.read();
        const fields = readDrawingFields(kind);
        this.store.update((state) => ({
            ...state,
            selectedId: null,
            draft: {
                id: this.config.newId(),
                kind,
                venue: contract.venue,
                instrumentSymbol: contract.symbol,
                anchors: Array.from({ length: ANCHORS_PER_KIND[kind] }, () => anchor),
                // What the tool is holding, and only a rotation where the
                // reader has not said. A reader marking three places on a chart
                // means the same thing at all three, and asking them again each
                // time is the tool asking a question it was already told.
                tone: pending.tone ?? chooseDrawingTone(drawn),
                // Weight is on every kind, because an emoji reads its type
                // size out of it. A line, though, is only a line on the kinds
                // that stroke one: written onto an emoji it is a setting the
                // painter can never act on and a reader can never see.
                width: pending.width,
                ...fields.hasStyle ? { style: pending.style } : {},
                ...fields.hasGlyph ? { glyph: pending.glyph } : {},
                ...fields.hasLabel && pending.label !== '' ? { label: pending.label } : {},
            },
        }));
    }

    /**
     * Follows the pointer with the end of the mark being drawn.
     */
    private reshapeDraft(anchor: DrawingAnchor): void {
        this.store.update((state) => {
            if (state.draft === null) {
                return state;
            }
            // A path grows; everything else has its ends moved. Every anchor
            // but the first follows, and a level has only the first, so the drag
            // fine-tunes that one in place rather than doing nothing.
            const anchors = isPathKind(state.draft.kind)
                ? growPath(state.draft.kind, state.draft.anchors, anchor)
                : state.draft.anchors.length === 1
                    ? [anchor]
                    : [state.draft.anchors[0]!, anchor];
            return { ...state, draft: { ...state.draft, anchors } };
        });
    }

    /**
     * Puts one end of the selected mark where the pointer is.
     */
    private reshapeSelected(index: number, anchor: DrawingAnchor): void {
        this.store.update((state) => {
            if (state.selectedId === null) {
                return state;
            }
            return {
                ...state,
                drawings: state.drawings.map((drawing) => (drawing.id === state.selectedId
                    ? moveDrawingAnchor(drawing, index, anchor)
                    : drawing)),
            };
        });
    }

    /**
     * Slides the selected mark by however far the pointer travelled.
     */
    private shiftSelected(shift: { deltaMs: number; deltaPrice: number }): void {
        this.store.update((state) => {
            if (state.selectedId === null) {
                return state;
            }
            return {
                ...state,
                drawings: state.drawings.map((drawing) => (drawing.id === state.selectedId
                    ? shiftDrawing(drawing, shift)
                    : drawing)),
            };
        });
    }

    /**
     * Keeps one step back, and says so to whatever offers the controls.
     */
    private rememberStep(before: readonly Drawing[]): void {
        this.renamingId = null;
        this.history.record(before);
        this.publishHistory();
    }

    /**
     * Puts the chart back to a set the history handed over.
     */
    private travel(drawings: readonly Drawing[] | null): void {
        if (drawings === null) {
            return;
        }
        this.store.update((state) => ({
            ...state,
            drawings,
            // A mark the step took away cannot stay selected, and the controls
            // for it would go on offering to remove what is no longer there.
            selectedId: drawings.some((drawing) => drawing.id === state.selectedId)
                ? state.selectedId
                : null,
        }));
        this.publishHistory();
        this.persist();
    }

    private publishHistory(): void {
        this.store.update((state) => ({
            ...state,
            canUndo: this.history.canUndo,
            canRedo: this.history.canRedo,
        }));
    }

    private persist(): void {
        const { drawings, recentGlyphs } = this.store.read();
        this.config.preferences.write({ drawings, recentGlyphs });
    }
}

/**
 * The path with the pointer's latest instant on the end of it.
 *
 * Stops growing at the cap rather than refusing the stroke: a reader mid-line
 * has not made a mistake, and a mark that vanished under their hand would be
 * read as the tool breaking.
 *
 * @param kind - What is being drawn, which decides whether the tail falls off.
 * @param anchors - The path so far.
 * @param anchor - Where the hand is now.
 * @returns The path to draw.
 */
function growPath(
    kind: DrawingKind,
    anchors: readonly DrawingAnchor[],
    anchor: DrawingAnchor,
): readonly DrawingAnchor[] {
    if (isRollingKind(kind)) {
        // Only its own tail. Kept whole, a laser's trail is a line drawn in
        // red rather than a pointer showing where the hand went.
        return [...anchors, anchor].slice(-LASER_TRAIL_ANCHORS);
    }
    return anchors.length >= MOST_PATH_ANCHORS ? anchors : [...anchors, anchor];
}

/**
 * Whether a mark covers any ground at all.
 *
 * @param drawing - The mark to measure.
 * @returns True when it is something a reader could see and grab.
 */
function hasExtent(drawing: Drawing): boolean {
    const [first, second] = drawing.anchors;
    if (first === undefined || second === undefined) {
        return true;
    }
    return first.atMs !== second.atMs || first.price !== second.price;
}

/**
 * The emoji a tool opens holding.
 *
 * The last one pinned, because a reader who marked four places yesterday means
 * the same thing today; the shipped first where they have pinned none.
 *
 * @param recent - What this reader has pinned, newest first.
 * @returns The glyph the tool starts on.
 */
function openingGlyph(recent: readonly string[]): string {
    return recent[0] ?? EMOJI_GLYPHS[0]!;
}

/**
 * The used list with one glyph at its head, however often it appeared before.
 *
 * Moved rather than added again, so the row reads as the ones this reader
 * reaches for rather than as a log of every press.
 *
 * @param recent - What was there, newest first.
 * @param glyph - The one just used.
 * @returns The list, newest first, bounded.
 */
function withGlyphUsed(recent: readonly string[], glyph: string): readonly string[] {
    return [glyph, ...recent.filter((one) => one !== glyph)].slice(0, MOST_RECENT_GLYPHS);
}

/**
 * The tone a new mark takes, so two crossing lines are told apart.
 *
 * @param drawn - What is already on the chart.
 * @returns The next tone in the cycle.
 */
function chooseDrawingTone(drawn: readonly Drawing[]): Drawing['tone'] {
    return INSTANCE_TONES[drawn.length % INSTANCE_TONES.length]!;
}

/**
 * Forgets the oldest marks once a chart holds more than it may.
 *
 * @param drawings - Everything drawn, oldest first.
 * @returns At most the bound, newest kept.
 */
function keepNewest(drawings: readonly Drawing[]): readonly Drawing[] {
    return drawings.length <= MAXIMUM_DRAWINGS_PER_INSTRUMENT
        ? drawings
        : drawings.slice(drawings.length - MAXIMUM_DRAWINGS_PER_INSTRUMENT);
}

/**
 * The tool a gesture leaves behind it.
 *
 * @param state - What is armed and whether the reader pinned it.
 * @returns The same tool while it is pinned, and nothing otherwise.
 */
function disarm(state: DrawingsState): DrawingKind | null {
    return state.isToolLocked ? state.armedTool : null;
}
