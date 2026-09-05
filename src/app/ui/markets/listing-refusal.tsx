import { CONTROL_CHIP_CLASSES, CONTROL_OFFERED_CLASSES } from '../control-shell.ts';
import type { ReactElement } from 'react';

export interface ListingRefusalProps {
    /** What the venue said, in its own words where it said anything. */
    readonly said: string;
    readonly retryLabel: string;
    readonly onRetry: () => void;
}

/**
 * A venue that would not answer, and the offer to ask it again.
 *
 * Where the list would have been rather than over it, so a refusal is never
 * read as a venue that lists nothing. Both places that read a listing show this
 * one: a reader who learns what a dead venue looks like in the picker should
 * not have to learn it again somewhere else.
 */
export function ListingRefusal({ said, retryLabel, onRetry }: ListingRefusalProps): ReactElement {
    return (
        <div className="flex min-h-0 flex-1 flex-col items-start gap-3 px-3 py-4">
            <p className="text-xs leading-snug text-amber">{said}</p>
            <button
                type="button"
                onClick={onRetry}
                className={`${CONTROL_CHIP_CLASSES} h-8 justify-center ${CONTROL_OFFERED_CLASSES}`}
            >
                {retryLabel}
            </button>
        </div>
    );
}
