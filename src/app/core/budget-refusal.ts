import { PLOT_BUDGET } from '../../shared/core/draw-plan.ts';
import type { PlanDraft } from '../../shared/core/draw-plan.ts';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';
import type { TranslationValues } from '../i18n/translator.ts';

/**
 * Why one layer drew nothing.
 *
 * A string where the reading itself threw — the author's own words, passed
 * through as they wrote them. A key and its numbers where the chart is the one
 * with something to say, because the chart's copy lives in the dictionaries.
 */
export type LayerRefusal = { readonly key: TranslationKey; readonly values: TranslationValues };
export type LayerFailure = string | LayerRefusal;

/**
 * Which of the budget's limits a plan went past.
 *
 * The limits are checked in the order a reader can act on: how many series,
 * then how long one is, then whether a series is malformed. A plan that passed
 * all three failed on a band, which is the only cause left.
 *
 * @param draft - A plan the host has already refused to draw.
 * @returns The phrase to render, as a key and the numbers it names.
 */
export function refusalFor(draft: PlanDraft): LayerRefusal {
    const { maximumSeriesCount, maximumVerticesPerSeries } = PLOT_BUDGET;
    if (draft.series.length > maximumSeriesCount) {
        return { key: 'budget.series', values: { drawn: draft.series.length, most: maximumSeriesCount } };
    }

    const longest = Math.max(0, ...draft.series.map((series) => series.atMs.length));
    if (longest > maximumVerticesPerSeries) {
        return { key: 'budget.points', values: { drawn: longest, most: maximumVerticesPerSeries } };
    }

    const uneven = draft.series.find((series) => series.atMs.length !== series.value.length);
    if (uneven !== undefined) {
        return { key: 'budget.uneven', values: { values: uneven.value.length, bars: uneven.atMs.length } };
    }

    return { key: 'budget.band', values: {} };
}
