/**
 * The rungs a venue serves candles on, against the rungs the chart draws.
 *
 * Every rung from a minute up has a venue equivalent; none below one does. That
 * is not a gap to work around — a venue publishes candles, and the finest it
 * publishes is a minute. Below that the only source of a bar is a recording of
 * the book, which is what the chart falls back to.
 */
const VENUE_INTERVALS: Readonly<Record<number, string>> = {
    60_000: '1m',
    300_000: '5m',
    900_000: '15m',
    1_800_000: '30m',
    3_600_000: '1h',
    14_400_000: '4h',
    86_400_000: '1d',
};

/**
 * What a venue calls the interval the chart is drawing.
 *
 * @param intervalMs - The rung the chart asked for.
 * @returns The venue's name for it, or null where the venue has no such candle.
 */
export function nameVenueInterval(intervalMs: number): string | null {
    return VENUE_INTERVALS[intervalMs] ?? null;
}

/**
 * Whether a venue can answer for a rung at all.
 *
 * @param intervalMs - The rung the chart asked for.
 * @returns True when candles of that width are published.
 */
export function isVenueInterval(intervalMs: number): boolean {
    return nameVenueInterval(intervalMs) !== null;
}
