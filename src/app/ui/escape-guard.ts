import { createContext, useContext, useEffect } from 'react';

export interface EscapeGuard {
    /** Claims the next Escape for something open inside the panel. */
    readonly claim: (isClaimed: boolean) => void;
}

/**
 * How something inside a panel keeps Escape from closing the panel.
 *
 * Radix listens for the key on the document with `capture: true`, so it has
 * already decided to dismiss before any handler on the field or the row runs —
 * calling `stopPropagation` there stops nothing, which is how a half-typed tag
 * name and a list of four numbers each took a three-deep stack of panels down
 * with them. The panel asks Radix not to dismiss instead, and the key still
 * reaches whatever claimed it, because refusing the dismissal is not the same
 * as stopping the event.
 */
export const EscapeGuardContext = createContext<EscapeGuard>({ claim: () => undefined });

/**
 * Claims Escape for as long as this is mounted.
 *
 * @param isOpen - True while the thing that should absorb the key is showing.
 */
export function useEscapeGuard(isOpen: boolean): void {
    const { claim } = useContext(EscapeGuardContext);
    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }
        claim(true);
        return () => { claim(false); };
    }, [claim, isOpen]);
}
