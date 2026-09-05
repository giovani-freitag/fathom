import type { RecordedContract } from '../../shared/core/recording-control.ts';
import type { VenueInstrument } from '../../shared/core/venue-connector.ts';

/**
 * How much finer and coarser than the middle a grid may be chosen.
 *
 * Three, because the middle is a guess from the tick and the price it is really
 * about is not known here: a reader looking at a pair knows in one glance
 * whether ten to a row is a wall or a smear, and this is their one chance to
 * say so — the grid a contract records on cannot be changed later without two
 * grids ending up in one history.
 */
const GRID_STEPS = [10, 100, 1_000] as const;

/** The grid offered in the middle, which is what a contract gets by default. */
export const DEFAULT_GRID_STEP = 1;

/** One grid a new contract may be recorded on. */
export interface GridChoice {
    /** The price band one row of the heat map covers. */
    readonly priceBucketSize: number;
    /** How many ticks that is, for a reader who knows the instrument. */
    readonly ticks: number;
}

/**
 * The grids worth offering for an instrument, finest first.
 *
 * Built from the tick because that is the only figure a listing carries: a
 * venue says what it quotes in, not what it trades at. Rounded to one, two or
 * five so the axis reads in the numbers people say out loud.
 *
 * @param instrument - The pair as the venue lists it.
 * @returns Three grids, or none where the venue published no tick at all.
 */
export function offerGrids(instrument: VenueInstrument): readonly GridChoice[] {
    if (!(instrument.priceStep > 0)) {
        return [];
    }

    return GRID_STEPS.map((ticks) => ({
        priceBucketSize: roundToNice(instrument.priceStep * ticks),
        ticks,
    }));
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
