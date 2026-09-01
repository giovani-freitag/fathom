import { describe, expect, it } from 'vitest';
import { columnsBetweenRewrites } from '../../../src/database/services/chunk-tile-recorder.ts';

const SECOND_MS = 1_000;

describe('columnsBetweenRewrites', () => {
    it('holds the finest level to a count of instants, which is the live edge', () => {
        expect(columnsBetweenRewrites(0, SECOND_MS)).toBe(16);
    });

    it('holds a coarse level to a stretch of time instead', () => {
        // A column of level one is four seconds, so fifteen of them is a minute.
        expect(columnsBetweenRewrites(1, 4 * SECOND_MS)).toBe(15);
    });

    it('asks for fewer columns the more time each of them is worth', () => {
        const each = [16, 64, 256].map((seconds) => columnsBetweenRewrites(2, seconds * SECOND_MS));

        expect(each).toEqual([4, 1, 1]);
    });

    it('waits a minute, or one column when a column is worth more', () => {
        // No level can be fresher than one of its own columns. What it must not
        // do is wait for many of them: counted in columns instead, the coarsest
        // waits four and a half hours, and a reader zooming out is answered with
        // a single stripe.
        for (const seconds of [4, 16, 64, 256, 1_024]) {
            const columnMs = seconds * SECOND_MS;
            const waitedMs = columnsBetweenRewrites(1, columnMs) * columnMs;

            expect(waitedMs).toBeLessThanOrEqual(Math.max(90 * SECOND_MS, columnMs));
        }
    });

    it('always asks for at least one column, however much it is worth', () => {
        expect(columnsBetweenRewrites(5, 10 * 60 * SECOND_MS)).toBe(1);
    });
});
