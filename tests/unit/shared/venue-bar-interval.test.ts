import { describe, expect, it } from 'vitest';
import { BAR_INTERVALS_MS } from '../../../src/app/core/bar-interval.ts';
import { isVenueInterval, nameVenueInterval } from '../../../src/shared/core/venue-bar-interval.ts';

const MINUTE_MS = 60_000;

describe('nameVenueInterval', () => {
    it('names every rung of a minute or more', () => {
        const unnamed = BAR_INTERVALS_MS
            .filter((rung) => rung >= MINUTE_MS)
            .filter((rung) => nameVenueInterval(rung) === null);

        expect(unnamed).toEqual([]);
    });

    it('names none below a minute, which no venue publishes', () => {
        // Not a gap to work around: the finest candle a venue publishes is a
        // minute, and below that the only source of a bar is the recording.
        const named = BAR_INTERVALS_MS
            .filter((rung) => rung < MINUTE_MS)
            .filter((rung) => nameVenueInterval(rung) !== null);

        expect(named).toEqual([]);
    });

    it('names a rung the way the venue does', () => {
        expect(nameVenueInterval(900_000)).toBe('15m');
    });

    it('names nothing for a width off the ladder entirely', () => {
        expect(nameVenueInterval(7_000)).toBeNull();
    });

    it('answers whether a venue can be asked at all', () => {
        expect([isVenueInterval(MINUTE_MS), isVenueInterval(1_000)]).toEqual([true, false]);
    });
});
