import { FIRST_VENUE } from '../core/recording-control.ts';
import type { VenueDeclaration } from '../core/venue-plan.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Every width this venue serves candles at, on the phase it opens them.
 *
 * The weekly bar opens on a Monday, which is four days past where the epoch
 * puts one — the anchor is why a rung is a pair rather than a number.
 */
const MONDAY_MS = 4 * DAY_MS;

/**
 * What the venue every recording so far came from can do.
 *
 * Written out rather than assumed, because it is the yardstick every other
 * connector is read against: this is the one venue whose candles carry a taker
 * split, and five shipped readings were written as though that were ordinary.
 */
export const BINANCE_FUTURES: VenueDeclaration = {
    book: {
        // Every update names the one before it, which is the check ADR 3 asks
        // for and the reason this venue could be trusted without a weaker one.
        grade: 'linked',
        levelsPerSide: 'all',
        publishIntervalMs: 100,
        clock: 'venue',
    },
    tape: {
        siding: 'sided',
        clock: 'venue',
        hasStableIds: true,
    },
    bars: {
        rungs: [
            { widthMs: MINUTE_MS, anchorMs: 0 },
            { widthMs: 5 * MINUTE_MS, anchorMs: 0 },
            { widthMs: 15 * MINUTE_MS, anchorMs: 0 },
            { widthMs: 30 * MINUTE_MS, anchorMs: 0 },
            { widthMs: HOUR_MS, anchorMs: 0 },
            { widthMs: 2 * HOUR_MS, anchorMs: 0 },
            { widthMs: 4 * HOUR_MS, anchorMs: 0 },
            { widthMs: DAY_MS, anchorMs: 0 },
            { widthMs: 7 * DAY_MS, anchorMs: MONDAY_MS },
        ],
        barsPerRequest: 1_500,
        hasVolume: true,
        // The line that made five readings portable-looking when they are not.
        hasBuyVolume: true,
        hasTradeCount: true,
    },
};

/** What the shipped venue is registered under. */
export const BINANCE_FUTURES_ID = FIRST_VENUE;
