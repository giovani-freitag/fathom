import type { Drawing, DrawingKind } from '../../shared/core/drawing.ts';
import type { DrawingRestyle } from '../drawings/drawings-controller.ts';
import type { DrawingsState } from '../drawings/drawings-controller.ts';
import { useEffect } from 'react';
import { useKernel } from './kernel-context.ts';
import { useStoreSlice } from './use-store.ts';

/** Keys that take a mark off the chart, both of which readers try. */
const REMOVE_KEYS = new Set(['Delete', 'Backspace']);

/**
 * Whether a key press belongs to something the reader is typing into.
 *
 * A shortcut that fires while a symbol is being typed deletes a mark the reader
 * never meant to touch.
 */
function isTypingInto(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    const name = element?.tagName;
    return name === 'INPUT' || name === 'TEXTAREA' || element?.isContentEditable === true;
}

/* Declared once each, so every subscription is the same one on every render. */
const readArmedTool = (state: DrawingsState): DrawingKind | null => state.armedTool;
const readSelectedId = (state: DrawingsState): string | null => state.selectedId;
const readSelected = (state: DrawingsState): Drawing | null => state.drawings
    .find((drawing) => drawing.id === state.selectedId) ?? null;
const readCanUndo = (state: DrawingsState): boolean => state.canUndo;
const readCanRedo = (state: DrawingsState): boolean => state.canRedo;

/**
 * What the drawing controls need to show, and what a press of one does.
 */
export interface DrawingControls {
    readonly armedTool: DrawingKind | null;
    readonly selectedId: string | null;
    /** How the selected mark is drawn, for the controls that show it. */
    readonly selected: Drawing | null;
    /** Arms a tool, or disarms the one already armed. */
    readonly toggleTool: (kind: DrawingKind) => void;
    /** Puts every tool down, so the pointer pans and selects again. */
    readonly disarm: () => void;
    /** Changes how the selected mark is drawn. */
    readonly restyleSelected: (look: DrawingRestyle) => void;
    /** Takes the selected mark off the chart. */
    readonly removeSelected: () => void;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /** Steps back one thing the reader did. */
    readonly undo: () => void;
    /** Steps forward one thing the reader undid. */
    readonly redo: () => void;
}

/**
 * The drawing tools, as the controls that offer them need them.
 *
 * @returns What is armed, what is selected, and the two things a press does.
 */
export function useDrawings(): DrawingControls {
    const kernel = useKernel();
    const armedTool = useStoreSlice(kernel.drawings.store, readArmedTool);
    const selectedId = useStoreSlice(kernel.drawings.store, readSelectedId);
    const selected = useStoreSlice(kernel.drawings.store, readSelected);
    const canUndo = useStoreSlice(kernel.drawings.store, readCanUndo);
    const canRedo = useStoreSlice(kernel.drawings.store, readCanRedo);

    // Every reader reaches for Delete before they reach for the button, and for
    // Escape when they change their mind about the tool they armed.
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (isTypingInto(event.target)) {
                return;
            }
            if (event.key === 'Escape') {
                kernel.drawings.arm(null);
                kernel.drawings.select(null);
                return;
            }
            if (REMOVE_KEYS.has(event.key) && selectedId !== null) {
                event.preventDefault();
                kernel.drawings.remove(selectedId);
                return;
            }
            // The chord every reader tries before they look for a button.
            if (event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                if (event.shiftKey) {
                    kernel.drawings.redo();
                } else {
                    kernel.drawings.undo();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => { window.removeEventListener('keydown', handleKeyDown); };
    }, [kernel, selectedId]);

    return {
        armedTool,
        selectedId,
        selected,
        // Pressing the armed tool again is how a reader says they are done
        // drawing, which is the only way back to a pointer that pans.
        toggleTool: (kind) => { kernel.drawings.arm(armedTool === kind ? null : kind); },
        disarm: () => { kernel.drawings.arm(null); },
        restyleSelected: (look) => {
            if (selectedId !== null) {
                kernel.drawings.restyle(selectedId, look);
            }
        },
        removeSelected: () => {
            if (selectedId !== null) {
                kernel.drawings.remove(selectedId);
            }
        },
        canUndo,
        canRedo,
        undo: () => { kernel.drawings.undo(); },
        redo: () => { kernel.drawings.redo(); },
    };
}
