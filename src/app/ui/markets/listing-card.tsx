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

                {/* The rows measure themselves against this, not against
                    the window: the card is 288 pixels wide on a phone
                    whichever way the phone is held. */}
                <section className="@container flex min-h-0 min-w-0 flex-1 flex-col">
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
                // A ticker is not a sentence, and the phone keyboard that
                // capitalises and corrects one turns "btc" into "Btc" on its way
                // into a search that matches neither.
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                className={`${CONTROL_INPUT_CLASSES} h-9 pl-8 pr-2`}
            />
        </>
    );
}


/**
 * The strip a phone's filters sit in, above the rows.
 *
 * Written once because every shape of the picker needs the same one: the shell
 * is the card's, and what goes in it is the shape's own business.
 */
export function RailBar({ children }: { readonly children: ReactNode }): ReactElement {
    return (
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline p-2">{children}</div>
    );
}

/**
 * The column of targets down the side of a card with room for one.
 *
 * A landmark rather than a div, because a reader on a screen reader arrives at
 * the rows and needs a way back to what points them somewhere else.
 */
export function RailColumn({ said, children }: {
    readonly said: string;
    readonly children: ReactNode;
}): ReactElement {
    return (
        <nav
            aria-label={said}
            className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline p-2"
        >
            {children}
        </nav>
    );
}

/**
 * The strip over the rows: what is being looked at, and what narrows it.
 *
 * The name is said quietly here rather than as a heading: it answers "which
 * listing is this" for a reader who scrolled, and competing with the rows for
 * attention is not what it is for.
 */
export function ListingBanner({ said, mark, children }: {
    readonly said: string;
    /** Drawn before the name, where the thing being looked at has a colour. */
    readonly mark?: ReactNode;
    /** What narrows the rows, which is the quote filter wherever there is one. */
    readonly children?: ReactNode;
}): ReactElement {
    return (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] text-ink-500">
                {mark}
                {said}
            </span>
            {children}
        </div>
    );
}
