import { describe, expect, it } from 'vitest';
import { refusalFor } from '../../../../src/app/core/budget-refusal.ts';
import { PLOT_BUDGET } from '../../../../src/shared/core/draw-plan.ts';
import type { PlanDraft, PlotSeries } from '../../../../src/shared/core/draw-plan.ts';

const seriesOf = (bars: number, values = bars): PlotSeries => ({
    label: 'A line',
    tone: 'phosphor',
    shape: 'line',
    atMs: new Float64Array(bars),
    value: new Float64Array(values),
});

const draftOf = (series: readonly PlotSeries[], bands?: PlanDraft['bands']): PlanDraft => ({
    series,
    scale: { kind: 'price' },
    ...bands === undefined ? {} : { bands },
});

/** A band naming a series the plan does not have, which is the last cause left. */
const outOfRangeBand = (): PlanDraft['bands'] => (
    [{ upperSeriesIndex: 0, lowerSeriesIndex: 9, tone: 'phosphor' }]
);

describe('why a plan the host refused was refused', () => {
    it('names how many series were drawn and how many are allowed', () => {
        const tooMany = Array.from({ length: PLOT_BUDGET.maximumSeriesCount + 2 }, () => seriesOf(3));

        expect(refusalFor(draftOf(tooMany))).toEqual({
            key: 'budget.series',
            values: { drawn: PLOT_BUDGET.maximumSeriesCount + 2, most: PLOT_BUDGET.maximumSeriesCount },
        });
    });

    it('names the longest series, not the first one over', () => {
        const over = PLOT_BUDGET.maximumVerticesPerSeries + 1;

        expect(refusalFor(draftOf([seriesOf(over), seriesOf(over + 500)])).values)
            .toEqual({ drawn: over + 500, most: PLOT_BUDGET.maximumVerticesPerSeries });
    });

    it('says a series is malformed when its values and its bars disagree', () => {
        expect(refusalFor(draftOf([seriesOf(4), seriesOf(4, 3)]))).toEqual({
            key: 'budget.uneven',
            values: { values: 3, bars: 4 },
        });
    });

    it('blames a band when nothing else is out of bounds', () => {
        // The four causes are checked in order, and a plan that passed the
        // first three failed on the only one left. Reported as a band without
        // that reasoning, a plan with ten series would be blamed on shading.
        expect(refusalFor(draftOf([seriesOf(4)], outOfRangeBand())).key).toBe('budget.band');
    });

    it('does not blame a band while a series is malformed', () => {
        expect(refusalFor(draftOf([seriesOf(4, 3)], outOfRangeBand())).key).toBe('budget.uneven');
    });

    it('has something to say about a plan with no series at all', () => {
        expect(refusalFor(draftOf([])).key).toBe('budget.band');
    });
});
