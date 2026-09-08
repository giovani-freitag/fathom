import { createPortal } from 'react-dom';
import type { ReactElement } from 'react';

export interface ToastProps {
    readonly message: string;
}

/**
 * A sentence the reader has to see, at the foot of the screen.
 *
 * Placed at the foot rather than in the panel that raised it: a panel is a
 * column a reader scrolls, so a line added to the end of one is a line below
 * the fold — on a phone the refusal that mattered was printed past the storage
 * slider, where nobody was looking, and the change simply appeared not to
 * happen.
 *
 * Mounted on the document rather than where it is written, because the drawer
 * these panels live in slides on a transform, and a transform makes its box the
 * one a fixed descendant is fixed to. Left in place, the toast landed in the
 * middle of the drawer, across the very rows it was talking about.
 *
 * @param props - The sentence to show.
 * @returns The toast, on the document.
 */
export function Toast({ message }: ToastProps): ReactElement | null {
    if (typeof document === 'undefined') {
        return null;
    }

    return createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
            <p
                // Announced rather than merely drawn: a reader who cannot see
                // where it landed is the reader this is most for.
                role="status"
                aria-live="polite"
                className="max-w-sm rounded-md border border-ask/40 bg-abyss-900/95 px-3 py-2 text-center text-[11px] leading-snug text-ask shadow-lg shadow-black/60 backdrop-blur-sm"
            >
                {message}
            </p>
        </div>,
        document.body,
    );
}
