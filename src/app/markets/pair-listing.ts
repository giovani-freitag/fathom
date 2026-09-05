import type { VenueInstrument } from '../../shared/core/venue-connector.ts';

/**
 * Rows put on screen at once before a reader is asked to narrow instead.
 *
 * A venue lists well over a thousand pairs. Drawing them all costs a second of
 * layout on every keystroke, and a reader is scrolling rather than looking by
 * the third screenful anyway — so the count of what was left out is shown, and
 * the search and the quote chips are what reach the rest.
 */
export const ROWS_SHOWN = 150;

/** Quote currencies offered as chips, most-traded first. */
export const QUOTES_OFFERED = 6;

/**
 * The share of a listing a quote has to cover before it is worth a chip.
 *
 * The shipped venue quotes eight hundred and fifty pairs against one currency
 * and two against another. Both are real, and a chip beside the first that
 * narrows nine hundred rows to two is not a filter — it is a slot spent. What
 * is left of the listing is reached by typing.
 */
const QUOTE_SHARE = 0.01;

/** What a reader narrowed the listing to. */
export interface PairFilter {
    /** Matched against the symbol and both assets, case-folded. */
    readonly query: string;
    /** The quote currency, or empty for every one of them. */
    readonly quote: string;
}

/** A listing narrowed, and how much of it did not fit. */
export interface NarrowedPairs {
    readonly shown: readonly VenueInstrument[];
    /** How many matched in all, which is more than `shown` on a wide listing. */
    readonly matched: number;
}

/**
 * The quote currencies worth offering as a filter, most-traded first.
 *
 * By how many pairs each quotes rather than alphabetically: a venue lists three
 * hundred against its own stablecoin and four against a currency nobody uses,
 * and an alphabetical list puts the four first.
 *
 * @param instruments - Everything the venue listed.
 * @returns Up to six quote currencies, the widest first.
 */
export function summariseQuotes(instruments: readonly VenueInstrument[]): readonly string[] {
    const counted = new Map<string, number>();
    for (const instrument of instruments) {
        counted.set(instrument.quote, (counted.get(instrument.quote) ?? 0) + 1);
    }

    const enough = instruments.length * QUOTE_SHARE;
    return [...counted]
        .filter(([, count]) => count >= enough)
        .sort((one, other) => other[1] - one[1] || one[0].localeCompare(other[0]))
        .slice(0, QUOTES_OFFERED)
        .map(([quote]) => quote);
}

/**
 * The pairs a reader's search and chips leave, and how many that was.
 *
 * @param instruments - Everything the venue listed.
 * @param filter - What the reader typed and which quote they picked.
 * @returns The rows to draw, and the total that matched.
 */
export function narrowPairs(
    instruments: readonly VenueInstrument[],
    filter: PairFilter,
): NarrowedPairs {
    const wanted = filter.query.trim().toUpperCase();
    const matched = instruments.filter((instrument) => (
        (filter.quote === '' || instrument.quote === filter.quote)
        && (wanted === ''
            || instrument.symbol.toUpperCase().includes(wanted)
            || instrument.base.toUpperCase().includes(wanted)
            || instrument.quote.toUpperCase().includes(wanted))
    ));

    return { shown: matched.slice(0, ROWS_SHOWN), matched: matched.length };
}
