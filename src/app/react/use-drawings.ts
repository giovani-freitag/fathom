import type { DrawingKind } from '../../shared/core/drawing.ts';
import type { DrawingsState } from '../drawings/drawings-controller.ts';
import { useKernel } from './kernel-context.ts';
import { useStoreSlice } from './use-store.ts';

/* Declared once each, so every subscription is the same one on every render. */
const readArmedTool = (state: DrawingsState): DrawingKind | null => state.armedTool;
const readSelectedId = (state: DrawingsState): string | null => state.selectedId;

/**
 * What the drawing controls need to show, and what a press of one does.
 */
export interface DrawingControls {
    readonly armedTool: DrawingKind | null;
    readonly selectedId: string | null;
    /** Arms a tool, or disarms the one already armed. */
    readonly toggleTool: (kind: DrawingKind) => void;
    /** Takes the selected mark off the chart. */
    readonly removeSelected: () => void;
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

    return {
        armedTool,
        selectedId,
        // Pressing the armed tool again is how a reader says they are done
        // drawing, which is the only way back to a pointer that pans.
        toggleTool: (kind) => { kernel.drawings.arm(armedTool === kind ? null : kind); },
        removeSelected: () => {
            if (selectedId !== null) {
                kernel.drawings.remove(selectedId);
            }
        },
    };
}
