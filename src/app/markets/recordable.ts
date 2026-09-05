import type { RecordedContract } from '../../shared/core/recording-control.ts';
import type { VenueInstrument } from '../../shared/core/venue-connector.ts';

/**
 * How many rows the middle grid puts across a price.
 *
 * Every contract this build has recorded lands between two and eight thousand:
 * BTC at ten to a row against eighty thousand, ETH at half against three, LTC
 * at a twentieth against a hundred. Four thousand is the middle of that, and it
 * is what makes a row mean the same thing on a pair worth eighty thousand and
 * one worth a tenth.
 */
const ROWS_ACROSS_PRICE = 4_000;

/** What the finer and coarser choices are, against the middle one. */
const GRID_SPREAD = [0.25, 1, 4] as const;

/** How many ticks the middle grid is, where the price is unknown. */
const TICKS_WITHOUT_A_PRICE = 100;

/** One grid a contract may be recorded on. */
export interface GridChoice {
    /** The price band one row of the heat map covers. */
    readonly priceBucketSize: number;
    /** True for the one derived from the price, which is the suggestion. */
    readonly isSuggested: boolean;
}

/**
 * The grids worth offering for an instrument, finest first.
 *
 * Anchored to what the pair trades at rather than to what the venue quotes in.
 * The tick says how finely a price may be written, which on one venue is a
 * hundredth of a per cent of the price and on another a hundred times that —
 * so grids built from it are a different band on every pair, and the reader is
 * asked a question whose numbers mean nothing.
 *
 * Never finer than the tick: a row narrower than the smallest move the venue
 * quotes is a ladder of stripes with nothing between them.
 *
 * @param instrument - The pair as the venue lists it.
 * @param lastPrice - What it last traded at, or null where nothing has said.
 * @returns Three grids, or none where neither a price nor a tick is known.
 */
export function offerGrids(
    instrument: VenueInstrument,
    lastPrice: number | null,
): readonly GridChoice[] {
    const middle = lastPrice !== null && lastPrice > 0
        ? roundToNice(lastPrice / ROWS_ACROSS_PRICE)
        : roundToNice(instrument.priceStep * TICKS_WITHOUT_A_PRICE);
    if (!(middle > 0)) {
        return [];
    }

    const offered = GRID_SPREAD
        .map((spread) => roundToNice(middle * spread))
        .map((priceBucketSize) => Math.max(priceBucketSize, instrument.priceStep));

    return [...new Set(offered)]
        .sort((one, other) => one - other)
        .map((priceBucketSize) => ({ priceBucketSize, isSuggested: priceBucketSize === middle }));
}

/**
 * Whether a venue's pairs can be recorded at all.
 *
 * The book is the recording. A venue that publishes none has nothing to capture
 * every second, however much else it answers.
 *
 * @param declaration - What that venue declared.
 * @returns True where there is a book to mirror.
 */
export function isRecordable(declaration: { readonly book: unknown }): boolean {
    return declaration.book !== null;
}

/**
 * Whether a contract is already on the list, by venue as well as symbol.
 *
 * @param contracts - What is being recorded.
 * @param venue - The venue the pair belongs to.
 * @param symbol - The pair.
 * @returns True where it is already there, on or off.
 */
export function isAlreadyRecorded(
    contracts: readonly RecordedContract[],
    venue: string,
    symbol: string,
): boolean {
    return contracts.some((contract) => contract.venue === venue
        && contract.instrumentSymbol === symbol);
}

/**
 * A figure rounded to the nearest one, two or five of its own size.
 *
 * A grid of 0.037 is a number nobody says. The axis it rules is read at a
 * glance, and it reads in the steps money is quoted in.
 */
function roundToNice(value: number): number {
    const size = 10 ** Math.floor(Math.log10(value));
    const shape = value / size;
    const chosen = shape < 1.5 ? 1 : shape < 3.5 ? 2 : shape < 7.5 ? 5 : 10;

    return Number((chosen * size).toPrecision(12));
}
