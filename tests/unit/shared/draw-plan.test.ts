import { describe, expect, it } from 'vitest';
import { readValueAt } from '../../../src/shared/core/draw-plan.ts';
import type { PlotSeries } from '../../../src/shared/core/draw-plan.ts';

function buildSeries(atMs: readonly number[], value: readonly number[]): PlotSeries {
    return {
        labelKey: 'indicator.sma',
        tone: 'phosphor',
        shape: 'line',
        atMs: Float64Array.from(atMs),
        value: Float64Array.from(value),
    };
}

describe('readValueAt', () => {
    it('reads the bar the instant falls in, not the closer neighbour', () => {
        // Two thirds of the way into a bar is still that bar's reading. Rounding
        // to the nearer vertex would show the next bar's value for half of this
        // one, which is a reading of a bar that has not closed.
        const series = buildSeries([1_000, 2_000, 3_000], [10, 20, 30]);

        expect(readValueAt(series, 2_900)).toBe(20);
    });

    it('says nothing before the series begins', () => {
        const series = buildSeries([1_000, 2_000], [10, 20]);

        expect(readValueAt(series, 500)).toBeNaN();
    });

    it('holds the last reading past the end', () => {
        const series = buildSeries([1_000, 2_000], [10, 20]);

        expect(readValueAt(series, 9_000)).toBe(20);
    });

    it('carries a gap through, so a hole reads as a hole', () => {
        const series = buildSeries([1_000, 2_000, 3_000], [10, Number.NaN, 30]);

        expect(readValueAt(series, 2_500)).toBeNaN();
    });
});
