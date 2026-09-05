import { CONTROL_INPUT_CLASSES } from '../control-shell.ts';
import type { ReactElement, ReactNode } from 'react';
import { Search } from 'lucide-react';

interface ListingCardProps {
    /** The search field, which is the same field wherever a listing is read. */
    readonly search: ReactNode;
    /** What the listing can be pointed at, down the side and along the top on a phone. */
    readonly rail: ReactNode;
    /** The strip over the rows: what is being looked at, and what narrows it. */
    readonly banner?: ReactNode;
    /** The line under the rows: what is still coming, or what did not fit. */
    readonly footing?: ReactNode;
    /** The rows, which scroll inside the card rather than moving it. */
    readonly children: ReactNode;
}

/**
 * The shape a listing is read in, wherever one is read.
 *
 * Search along the top, targets down the side, rows filling the rest and
 * scrolling inside themselves. Written once because there are two of them now —
 * the pairs a reader keeps and the pairs a venue offers to record — and a
 * second one built to look like the first is one that stops looking like it on
 * the next change.
 *
 * The scroll is the part that has to be shared rather than copied: every band
 * here holds its own height, so the rows are the only thing that moves and the
 * search and the rail stay where the reader left them.
 */
export function ListingCard({ search, rail, banner, footing, children }: ListingCardProps): ReactElement {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <header className="relative shrink-0 border-b border-hairline p-2">
                {search}
            </header>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                {rail}

                <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {banner}
                    {children}
                    {footing}
                </section>
            </div>
        </div>
    );
}

interface SearchFieldProps {
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    /** The field a reader lands in, which is the one the card opened for. */
    readonly hasFocus?: boolean;
    readonly name?: string;
}

/** The one search field, with its glyph inside it rather than beside it. */
export function SearchField({
    label,
    value,
    onChange,
    hasFocus = false,
    name = 'pairSearch',
}: SearchFieldProps): ReactElement {
    return (
        <>
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
            <input
                autoFocus={hasFocus}
                type="search"
                name={name}
                aria-label={label}
                placeholder={label}
                value={value}
                onChange={(event) => { onChange(event.target.value); }}
                className={`${CONTROL_INPUT_CLASSES} h-9 pl-8 pr-2`}
            />
        </>
    );
}
