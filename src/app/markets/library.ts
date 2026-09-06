import type { MarketPair, PairTag } from '../../shared/core/pair-tags.ts';

/** One pair a reader has some claim on, and why. */
export interface LibraryPair {
    readonly pair: MarketPair;
    /** True where the chart is recording it, so it can be drawn. */
    readonly isRecorded: boolean;
    /** Which of the reader's tags hold it. */
    readonly held: ReadonlySet<string>;
}

/**
 * The pairs a reader has a claim on, gathered into one list.
 *
 * The picker used to open on a catalogue of nine hundred, or on a tag that a
 * new reader has not filled yet — a screen that answers nothing on the way to
 * the four or five pairs anybody actually watches. What a reader has is small:
 * what the chart records, what they filed under a tag, and what is on the
 * screen right now. That is the list worth opening on, and everything else is a
 * catalogue they go to deliberately.
 *
 * Mixed rather than grouped by where each came from: a pair that is both
 * recorded and tagged is one pair, and listing it twice under two headings is
 * the same row asking to be read twice.
 *
 * @param recorded - Every pair the chart holds a recording of.
 * @param tags - The reader's tags, each with the pairs filed under it.
 * @param open - What the chart is showing, which belongs here even if untagged.
 * @returns One row per pair, in a stable order: recorded first, then the rest.
 */
export function gatherLibrary(
    recorded: readonly MarketPair[],
    tags: readonly PairTag[],
    open: MarketPair | null,
): readonly LibraryPair[] {
    const at = (pair: MarketPair): string => `${pair.venue}/${pair.symbol}`;
    const isRecorded = new Set(recorded.map(at));
    const held = new Map<string, Set<string>>();
    const known = new Map<string, MarketPair>();

    for (const pair of recorded) {
        known.set(at(pair), pair);
    }
    for (const tag of tags) {
        for (const pair of tag.pairs) {
            known.set(at(pair), pair);
            const already = held.get(at(pair)) ?? new Set<string>();
            already.add(tag.id);
            held.set(at(pair), already);
        }
    }
    if (open !== null) {
        known.set(at(open), open);
    }

    return [...known.values()]
        .map((pair) => ({
            pair,
            isRecorded: isRecorded.has(at(pair)),
            held: held.get(at(pair)) ?? new Set<string>(),
        }))
        // Recorded first, because those are the ones that draw. Then by name,
        // so the list a reader learns stays where they learned it.
        .sort((one, other) => Number(other.isRecorded) - Number(one.isRecorded)
            || one.pair.symbol.localeCompare(other.pair.symbol)
            || one.pair.venue.localeCompare(other.pair.venue));
}

/** What a library list is narrowed to. */
export type LibraryFilter =
    | { readonly kind: 'all' }
    | { readonly kind: 'recording' }
    | { readonly kind: 'tag'; readonly tagId: string };

/**
 * The rows one chip leaves.
 *
 * @param rows - The whole library.
 * @param filter - Which chip is pressed.
 * @returns Those the chip admits, in the order they came.
 */
export function narrowLibrary(
    rows: readonly LibraryPair[],
    filter: LibraryFilter,
): readonly LibraryPair[] {
    if (filter.kind === 'all') {
        return rows;
    }
    if (filter.kind === 'recording') {
        return rows.filter((row) => row.isRecorded);
    }
    return rows.filter((row) => row.held.has(filter.tagId));
}
