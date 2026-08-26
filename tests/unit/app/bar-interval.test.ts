import { BAR_INTERVALS_MS, chooseBarIntervalMs } from '../../../src/app/core/bar-interval.ts';
import { describe, expect, it } from 'vitest';

const HOUR_MS = 3_600_000;

describe('chooseBarIntervalMs', () => {
    it('answers with a rung of the ladder and never a computed number', () => {
        const chosen = chooseBarIntervalMs({
            viewportSpanMs: 7 * 60_000, targetBarCount: 3, frameIntervalMs: 1_000,
        });

        expect(BAR_INTERVALS_MS).toContain(chosen);
    });

    it('gives the same rung whatever the surface is, which is the whole point', () => {
        // The bug this replaces: bins came from plot width, so the same viewport
        // measured 4.7x apart between a phone and a desktop.
        const forSpan = (viewportSpanMs: number) =>
            chooseBarIntervalMs({ viewportSpanMs, targetBarCount: 120, frameIntervalMs: 1_000 });

        expect(new Set([forSpan(HOUR_MS), forSpan(HOUR_MS), forSpan(HOUR_MS)]).size).toBe(1);
    });

    it('widens the rung as the window widens', () => {
        const narrow = chooseBarIntervalMs({ viewportSpanMs: HOUR_MS, targetBarCount: 120, frameIntervalMs: 1_000 });
        const wide = chooseBarIntervalMs({ viewportSpanMs: 24 * HOUR_MS, targetBarCount: 120, frameIntervalMs: 1_000 });

        expect(wide).toBeGreaterThan(narrow);
    });

    it('never goes finer than the grid the instrument was recorded on', () => {
        const chosen = chooseBarIntervalMs({
            viewportSpanMs: 60_000, targetBarCount: 600, frameIntervalMs: 5_000,
        });

        expect(chosen).toBeGreaterThanOrEqual(5_000);
    });

    it('holds at the finest rung rather than inventing one below it', () => {
        expect(chooseBarIntervalMs({ viewportSpanMs: 100, targetBarCount: 120, frameIntervalMs: 1_000 }))
            .toBe(1_000);
    });
});

describe('chooseBarIntervalMs and the count it produces', () => {
    /** How many bars a span would hold at the chosen rung. */
    function barsAcross(viewportSpanMs: number, targetBarCount: number): number {
        return viewportSpanMs / chooseBarIntervalMs({
            viewportSpanMs, targetBarCount, frameIntervalMs: 1_000,
        });
    }

    it('never draws more bars than were asked for', () => {
        // Choosing the rung below the wanted width overshoots the count, and at
        // fifteen minutes that is a one-second bar under two pixels wide — a
        // dotted line where the reader asked for candles.
        for (const spanMs of [900_000, 3_600_000, 14_400_000, 86_400_000]) {
            expect(barsAcross(spanMs, 240)).toBeLessThanOrEqual(240);
        }
    });

    it('stays close to the count rather than collapsing to a handful', () => {
        expect(barsAcross(900_000, 240)).toBeGreaterThan(120);
    });
});
