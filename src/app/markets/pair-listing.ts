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
    /**
     * Symbols the row cut may not drop, drawn before everything else.
     *
     * What the chart is already recording, so that it stays reachable however
     * far down the alphabet the venue files it.
     */
    readonly keep?: ReadonlySet<string> | undefined;
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
 * Ranked as well as filtered, because a listing is cut at a hundred and fifty
 * rows: typing `btc` on a venue with two thousand pairs matches every pair
 * quoted in it, and the one the reader meant sat thirteenth behind LTC_BTC and
 * DOGE_BTC — inside the cut on that venue, and outside it on the next.
 *
 * @param instruments - Everything the venue listed.
 * @param filter - What the reader typed, which quote they picked, and which
 *                 symbols the cut is not allowed to drop.
 * @returns The rows to draw, best first, and the total that matched.
 */
export function narrowPairs(
    instruments: readonly VenueInstrument[],
    filter: PairFilter,
): NarrowedPairs {
    const wanted = filter.query.trim().toUpperCase();
    const byQuote = filter.quote === ''
        ? instruments
        : instruments.filter((instrument) => instrument.quote === filter.quote);

    // Left in the venue's own order where nothing was typed: it opens on what
    // that venue is known for, and sorting it puts a leveraged token first.
    if (wanted === '') {
        return { shown: keepFirst(byQuote, filter.keep).slice(0, ROWS_SHOWN), matched: byQuote.length };
    }

    // Scored once per pair rather than once per comparison: a sort asks its
    // comparator O(n log n) times and this was scoring both sides of each. Worth
    // saying plainly that the saving is small — measured over nine hundred pairs
    // and a query that matches nearly all of them, 0.18 ms a call becomes 0.11.
    // It is here because a score computed twice is a score that can disagree
    // with itself if it ever stops being pure, not because a keystroke was slow.
    const ranked: { instrument: VenueInstrument; rank: number }[] = [];
    for (const instrument of byQuote) {
        const rank = rankAgainst(instrument, wanted);
        if (rank < NO_MATCH) {
            ranked.push({ instrument, rank });
        }
    }

    ranked.sort((one, other) => one.rank - other.rank
        || one.instrument.symbol.localeCompare(other.instrument.symbol));

    return {
        shown: keepFirst(ranked.map((scored) => scored.instrument), filter.keep).slice(0, ROWS_SHOWN),
        matched: ranked.length,
    };
}

/**
 * The rows that must survive the cut, brought to the front of it.
 *
 * A listing stops at a hundred and fifty rows and a venue lists nine hundred,
 * so a pair this chart is recording sat outside the cut and could be reached
 * only by typing a name the reader had no way to know was there. A recording
 * nobody can see is a recording nobody can stop.
 */
function keepFirst(
    ordered: readonly VenueInstrument[],
    keep: ReadonlySet<string> | undefined,
): readonly VenueInstrument[] {
    if (keep === undefined || keep.size === 0) {
        return ordered;
    }
    const pinned = ordered.filter((instrument) => keep.has(instrument.symbol));
    return pinned.length === 0
        ? ordered
        : [...pinned, ...ordered.filter((instrument) => !keep.has(instrument.symbol))];
}

/** What a pair scores against what was typed; lower is nearer. */
const NO_MATCH = 9;

/**
 * How near a pair is to what was typed.
 *
 * The order a reader means it in: the asset they named first, then the pair
 * whose name begins that way, and only then everything that merely contains it
 * somewhere — which on most venues is every pair quoted in the thing they typed.
 */
function rankAgainst(instrument: VenueInstrument, wanted: string): number {
    const symbol = instrument.symbol.toUpperCase();
    const base = instrument.base.toUpperCase();
    const quote = instrument.quote.toUpperCase();

    if (symbol === wanted || base === wanted) {
        return 0;
    }
    if (base.startsWith(wanted)) {
        return 1;
    }
    if (symbol.startsWith(wanted)) {
        return 2;
    }
    if (quote === wanted) {
        return 3;
    }
    if (base.includes(wanted) || symbol.includes(wanted)) {
        return 4;
    }
    return quote.includes(wanted) ? 5 : NO_MATCH;
}
