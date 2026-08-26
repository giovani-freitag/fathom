import { describe, expect, it } from 'vitest';
import { readValueAt, recolourPlan } from '../../../src/shared/core/draw-plan.ts';
import type { DrawPlan, PlotSeries } from '../../../src/shared/core/draw-plan.ts';

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

describe('recolourPlan on a plan that colours itself', () => {
    it('leaves a reading that is told by its colour alone', () => {
        // Volume is green because the bar rose. Painted in the colour the copy
        // is identified by, the chart would be claiming every bar rose.
        const plan: DrawPlan = {
            indicatorId: 'volume',
            labelKey: 'indicator.volume',
            parameterSummary: '',
            scale: { kind: 'overlay', heightRatio: 0.2 },
            isSelfColoured: true,
            series: [
                { labelKey: 'a', tone: 'bid', shape: 'histogram', baseline: 0, atMs: Float64Array.from([1]), value: Float64Array.from([2]) },
                { labelKey: 'b', tone: 'ask', shape: 'histogram', baseline: 0, atMs: Float64Array.from([1]), value: Float64Array.from([3]) },
            ],
            hasConverged: true,
        };

        const recoloured = recolourPlan(plan, 'muted');

        expect(recoloured.series.map((series) => series.tone)).toEqual(['bid', 'ask']);
    });
});
