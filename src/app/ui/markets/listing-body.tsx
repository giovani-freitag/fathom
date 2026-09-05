import { CONTROL_CHIP_CLASSES, CONTROL_CHOSEN_CLASSES, CONTROL_OFFERED_CLASSES } from '../control-shell.ts';
import type { Listing } from '../../core/markets-controller.ts';
import { ListingRefusal } from './listing-refusal.tsx';
import type { ReactElement } from 'react';
import type { Translate } from '../../i18n/translator.ts';

export interface ListingBodyProps {
    readonly listing: Listing;
    /** How many rows the caller is about to draw, across all of its groups. */
    readonly rowCount: number;
    /** What was typed, which changes what "still reading" should say. */
    readonly query: string;
    /** Said where a venue answers nothing; a tag says something else. */
    readonly emptySaid: string;
    readonly translate: Translate;
    readonly onRetry: () => void;
    readonly children: ReactElement;
}

/**
 * The rows, or the one sentence that stands in for them.
 *
 * Every state a listing can be in is answered here rather than inside whatever
 * draws the rows, so that a table only ever draws tables. Written once because
 * it was written twice and the copy had already lost a clause: it tested the
 * kind of the listing but not whether anything had arrived, and a venue writes
 * `reading` with an empty page the instant it is asked. For the seconds a
 * listing takes, the second surface drew an empty frame — indistinguishable
 * from a venue that lists nothing, and from a card that had broken.
 */
export function ListingBody({
    listing,
    rowCount,
    query,
    emptySaid,
    translate,
    onRetry,
    children,
}: ListingBodyProps): ReactElement {
    // Only until the first page lands: after that the rows are the answer, and
    // the line under them says the rest is still coming.
    const isEmptyStill = listing.kind === 'unread'
        || (listing.kind === 'reading' && listing.instruments.length === 0);

    if (isEmptyStill) {
        // Typing into a listing that has not arrived looks like typing into a
        // box that is not listening, and a venue serving its whole listing in
        // one answer leaves several seconds of exactly that.
        return <Said said={translate(query.trim() === '' ? 'markets.reading' : 'markets.readingBeforeSearch')} />;
    }

    if (listing.kind === 'refused') {
        return (
            <ListingRefusal
                said={listing.said ?? translate('markets.noConnector')}
                retryLabel={translate('markets.retry')}
                onRetry={onRetry}
            />
        );
    }

    return rowCount === 0 ? <Said said={emptySaid} /> : children;
}

/**
 * One sentence where the rows would have been.
 */
export function Said({ said }: { readonly said: string }): ReactElement {
    // Announced, because it stands where the list would be and says what
    // happened to it. Focus stays on the venue that was tapped, so without this
    // a reader hears nothing at all between asking and the rows arriving.
    return (
        <p role="status" className="min-h-0 flex-1 px-3 py-4 text-xs leading-snug text-ink-500">{said}</p>
    );
}

export interface ListingFootingProps {
    readonly listing: Listing;
    /** Rows actually drawn, after the cut. */
    readonly shown: number;
    /** Rows that matched, before it. */
    readonly matched: number;
    /** True while the venue is being asked about what was typed. */
    readonly isAsking: boolean;
    readonly translate: Translate;
}

/**
 * What the rows do not say for themselves: that more are coming, or were cut.
 */
export function ListingFooting(props: ListingFootingProps): ReactElement | null {
    const said = readFooting(props);
    if (said === null) {
        return null;
    }

    return (
        <p className="shrink-0 border-t border-hairline px-3 py-2 text-[11px] text-ink-500">{said}</p>
    );
}

/**
 * Which of those it is, in the order that matters to a reader.
 */
function readFooting({ listing, shown, matched, isAsking, translate }: ListingFootingProps): string | null {
    if (isAsking) {
        return translate('markets.askingVenue');
    }
    if (listing.kind === 'reading' && listing.instruments.length > 0) {
        return listing.total === null
            ? translate('markets.readingSome', { read: String(listing.instruments.length) })
            : translate('markets.readingOf', {
                read: String(listing.instruments.length),
                total: String(listing.total),
            });
    }
    return matched > shown
        ? translate('markets.shownOf', { shown: String(shown), matched: String(matched) })
        : null;
}

export interface QuoteFilterProps {
    /** The quote currencies this venue actually lists, in its own order. */
    readonly quotes: readonly string[];
    /** Which is in force; the empty string is all of them. */
    readonly quote: string;
    readonly translate: Translate;
    readonly onPick: (quote: string) => void;
}

/**
 * The quote currencies a listing can be narrowed to.
 *
 * Written once because the second copy had already drifted: it spelled the
 * chosen colours out by hand, in a file that imports the constant holding them
 * three lines above.
 */
export function QuoteFilter({ quotes, quote, translate, onPick }: QuoteFilterProps): ReactElement | null {
    if (quotes.length === 0) {
        return null;
    }

    return (
        <div className="ml-auto flex flex-wrap gap-1">
            {['', ...quotes].map((one) => (
                <button
                    key={one === '' ? 'all' : one}
                    type="button"
                    aria-pressed={quote === one}
                    onClick={() => { onPick(one); }}
                    className={`${CONTROL_CHIP_CLASSES} h-7 justify-center px-2.5 ${
                        quote === one ? CONTROL_CHOSEN_CLASSES : CONTROL_OFFERED_CLASSES
                    }`}
                >
                    {one === '' ? translate('markets.allQuotes') : one}
                </button>
            ))}
        </div>
    );
}
