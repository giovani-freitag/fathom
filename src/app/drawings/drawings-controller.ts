import {
    ANCHORS_PER_KIND,
    type Drawing,
    type DrawingAnchor,
    type DrawingKind,
    type DrawingStyle,
    type DrawingWidth,
    isTransientKind,
    moveDrawingAnchor,
    shiftDrawing,
} from '../../shared/core/drawing.ts';
import { INSTANCE_TONES, type PlotTone } from '../../shared/core/draw-plan.ts';
import { DrawingHistory } from './drawing-history.ts';
import { ObservableStore } from '../core/observable-store.ts';
import type { PreferencesService } from '../services/preferences-service.ts';

/** Marks one chart may hold, past which the oldest is forgotten. */
export const MAXIMUM_DRAWINGS_PER_INSTRUMENT = 64;

/**
 * What the reader has drawn, and what they are drawing now.
 */
export interface DrawingsState {
    /** The tool the next press will draw with, or null while the pointer selects. */
    readonly armedTool: DrawingKind | null;
    readonly drawings: readonly Drawing[];
    readonly selectedId: string | null;
    /** The mark being dragged out, drawn but not yet kept. */
    readonly draft: Drawing | null;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
}

/** What about a mark's look is being changed. */
export interface DrawingRestyle {
    readonly tone?: PlotTone;
    readonly width?: DrawingWidth;
    readonly style?: DrawingStyle;
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
    readonly readInstrumentSymbol: () => string | null;
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
    /** Which end the gesture has hold of, or null when it has the whole mark. */
    private grabbedAnchorIndex: number | null = null;
    /**
     * What was on the chart when the gesture began.
     *
     * Held rather than recorded per move: a drag rewrites a mark many times a
     * second, and a step back per frame is not a step a reader can use.
     */
    private beforeGesture: readonly Drawing[] | null = null;

    constructor(config: DrawingsControllerConfig) {
        this.config = config;
        this.store = new ObservableStore<DrawingsState>({
            initialState: {
                armedTool: null,
                drawings: config.preferences.read().drawings,
                selectedId: null,
                draft: null,
                canUndo: false,
                canRedo: false,
            },
        });
    }

    /**
     * Arms a tool for the next press, or hands the pointer back to selection.
     *
     * @param armedTool - The kind to draw next, or null to select instead.
     */
    arm(armedTool: DrawingKind | null): void {
        this.store.update((state) => ({ ...state, armedTool, draft: null }));
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
        const { armedTool } = this.store.read();
        if (armedTool !== null) {
            this.startDraft(armedTool, press.anchor);
            return;
        }
        this.select(press.hitId);
    }

    /**
     * Points the controls at one mark, or at none.
     *
     * @param drawingId - The mark to select, or null to select nothing.
     */
    select(drawingId: string | null): void {
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
        if (draft !== null && !hasExtent(draft)) {
            // A click where a drag was needed leaves a mark of no length: kept,
            // it is invisible, unselectable, and stored for ever.
            this.store.update((state) => ({ ...state, draft: null }));
            return;
        }
        if (draft !== null && isTransientKind(draft.kind)) {
            // Left on screen but never stored: it is read where it was drawn
            // and then done with, so it is neither persisted nor undoable.
            this.store.update((state) => ({ ...state, armedTool: null }));
            return;
        }
        if (draft !== null) {
            // Kept selected, so the mark a reader just made is the one a press
            // of Delete removes without hunting for it again.
            this.store.update((state) => ({
                ...state,
                armedTool: null,
                draft: null,
                selectedId: draft.id,
                drawings: keepNewest([...state.drawings, draft]),
            }));
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
     * Changes how one mark is drawn.
     *
     * @param drawingId - The mark to restyle.
     * @param look - Whichever of its tone, weight and line to change.
     */
    restyle(drawingId: string, look: DrawingRestyle): void {
        this.rememberStep(this.store.read().drawings);
        this.store.update((state) => ({
            ...state,
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
        const instrumentSymbol = this.config.readInstrumentSymbol();
        if (instrumentSymbol === null) {
            return;
        }

        const drawn = this.store.read().drawings;
        this.store.update((state) => ({
            ...state,
            selectedId: null,
            draft: {
                id: this.config.newId(),
                kind,
                instrumentSymbol,
                anchors: Array.from({ length: ANCHORS_PER_KIND[kind] }, () => anchor),
                tone: chooseDrawingTone(drawn),
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
            // Every anchor but the first follows: a level has only the first, so
            // the drag fine-tunes it in place rather than doing nothing.
            const anchors = state.draft.anchors.length === 1
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
        this.config.preferences.write({ drawings: this.store.read().drawings });
    }
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
