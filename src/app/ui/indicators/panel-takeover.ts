import { createContext, useContext } from 'react';

export interface PanelTakeover {
    /** Told by a layer's panel that it is showing a step of its own. */
    readonly take: (isTaken: boolean) => void;
}

/**
 * How a layer's panel says it has taken the drawer.
 *
 * A step inside a layer's settings is a screen, not a section: opening it under
 * the layer's own knobs puts it below the fold on a phone, where the knobs are
 * a screen tall by themselves. The panel says it has taken over and the drawer
 * stands down, which keeps the knowledge of what a step looks like in the
 * drawer and the knowledge of when there is one in the layer.
 */
export const PanelTakeoverContext = createContext<PanelTakeover>({ take: () => undefined });

/**
 * The drawer this panel is drawn in, for a panel that opens a step.
 *
 * @returns The takeover, which does nothing where a panel is drawn on its own.
 */
export function usePanelTakeover(): PanelTakeover {
    return useContext(PanelTakeoverContext);
}
