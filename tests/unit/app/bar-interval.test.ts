import { BAR_INTERVALS_MS, chooseBarIntervalMs, resolveBarIntervalMs } from '../../../src/app/core/bar-interval.ts';
import { describe, expect, it } from 'vitest';
import { nameVenueInterval } from '../../../src/shared/core/venue-bar-interval.ts';

const HOUR_MS = 3_600_000;

describe('chooseBarIntervalMs', () => {
    it('answers with a rung of the ladder and never a computed number', () => {
        const chosen = chooseBarIntervalMs({
            viewportSpanMs: 7 * 60_000,
            targetBarCount: 3,
        });

        expect(BAR_INTERVALS_MS).toContain(chosen);
    });

    it('gives the same rung whatever the surface is, which is the whole point', () => {
        // The bug this replaces: bins came from plot width, so the same viewport
        // measured 4.7x apart between a phone and a desktop.
        const forSpan = (viewportSpanMs: number) =>
            chooseBarIntervalMs({ viewportSpanMs, targetBarCount: 120 });

        expect(new Set([forSpan(HOUR_MS), forSpan(HOUR_MS), forSpan(HOUR_MS)]).size).toBe(1);
    });

    it('widens the rung as the window widens', () => {
        const narrow = chooseBarIntervalMs({ viewportSpanMs: HOUR_MS, targetBarCount: 120 });
        const wide = chooseBarIntervalMs({ viewportSpanMs: 24 * HOUR_MS, targetBarCount: 120 });

        expect(wide).toBeGreaterThan(narrow);
    });

    it('holds at the finest rung rather than inventing one below it', () => {
        // Which is a minute: the finest candle any venue publishes, and so the
        // finest bar there is anything to draw.
        expect(chooseBarIntervalMs({ viewportSpanMs: 100, targetBarCount: 120 })).toBe(60_000);
    });

    it('offers only rungs the venue publishes a candle for', () => {
        const unpublished = BAR_INTERVALS_MS.filter((rung) => nameVenueInterval(rung) === null);

        expect(unpublished).toEqual([]);
    });
});

describe('chooseBarIntervalMs and the count it produces', () => {
    /** How many bars a span would hold at the chosen rung. */
    function barsAcross(viewportSpanMs: number, targetBarCount: number): number {
        return viewportSpanMs / chooseBarIntervalMs({ viewportSpanMs, targetBarCount });
    }

    it('never draws more bars than were asked for', () => {
        // Choosing the rung below the wanted width overshoots the count, and at
        // fifteen minutes that is a one-second bar under two pixels wide — a
        // dotted line where the reader asked for candles.
        for (const spanMs of [900_000, 3_600_000, 14_400_000, 86_400_000]) {
            expect(barsAcross(spanMs, 240)).toBeLessThanOrEqual(240);
        }
    });

    it('stays close to the count wherever the ladder has a rung for it', () => {
        expect(barsAcross(4 * HOUR_MS, 240)).toBeGreaterThan(120);
    });

    it('gives a narrow window the minute, which is the finest candle there is', () => {
        // A quarter of an hour holds fifteen of them. It held nine hundred when
        // bars came out of the recorded book, and that is the price of a candle
        // that means the same thing on every chart that draws one.
        expect(barsAcross(900_000, 240)).toBe(15);
    });
});

describe('resolveBarIntervalMs', () => {
    const WINDOW = { viewportSpanMs: 15 * 60_000, targetBarCount: 240 };

    it('fits the window when the reader has named nothing', () => {
        expect(resolveBarIntervalMs(null, WINDOW)).toBe(chooseBarIntervalMs(WINDOW));
    });

    it('honours a rung the reader named over the one that fits', () => {
        // Naming a rung is what makes zooming change how many bars are seen
        // rather than how much each one covers.
        expect(resolveBarIntervalMs(HOUR_MS, WINDOW)).toBe(HOUR_MS);
    });

    it('draws the rung named even where the window would have fitted another', () => {
        expect(resolveBarIntervalMs(86_400_000, WINDOW)).toBe(86_400_000);
    });
});
