/**
 * Everything an addon may reach, and nothing else.
 *
 * One file so the surface is a list somebody can read, and so widening it is a
 * deliberate edit rather than a stray export somewhere in the tree.
 */

export type {
    ChoiceParameter,
    DrawPlan,
    Indicator,
    IndicatorInput,
    IndicatorParameter,
    IndicatorSettings,
    NumericParameter,
    PlanDraft,
    PlotBand,
    PlotLevel,
    PlotScale,
    PlotSeries,
    PlotShape,
    PlotTone,
    SessionRequest,
    SettledSessions,
    SourceRequest,
    ToggleParameter,
    Tunable,
} from './draw-plan.ts';

export {
    isPlanWithinBudget,
    NO_SESSIONS,
    PLOT_BUDGET,
    PLOT_TONES,
    readChoice,
    readSessions,
    readSetting,
    readToggle,
    summariseParameters,
} from './draw-plan.ts';

export type { BarCompleteness, PriceBar, PriceBarWindow } from './price-bar.ts';
export { BAR_BUDGET, classifyBar } from './price-bar.ts';

export type { BarSegment, SeriesFill } from './series-math.ts';
export {
    collectInstants,
    collectTrueRanges,
    createBlankValues,
    fillExponential,
    fillWilder,
    findContinuousSegments,
    resolveExponentialWeight,
    resolveTrueRange,
    smoothWilder,
} from './series-math.ts';

export type { BarSource } from './bar-source.ts';
export { BAR_SOURCES, collectSource, readBarSource, SOURCE } from './bar-source.ts';

export { holdLastClosed } from './settled-sessions.ts';

export type { PlotValues } from './plot-builder.ts';
export type { ChoiceBuilder, NumericBuilder, ToggleBuilder } from './parameter-builder.ts';

import {
    choiceParameter,
    decimalParameter,
    integerParameter,
    toggleParameter,
} from './parameter-builder.ts';
import { plotOver } from './plot-builder.ts';

/**
 * Starts a plan, bound to the bars every series lines up with.
 *
 * @example
 * Plot.over(input.bars).line(mean, 'Mean').in('amber').overThePrice()
 */
export const Plot = { over: plotOver } as const;

/**
 * The knobs a reading offers, each already a usable parameter as it is built.
 *
 * @example
 * Params.integer('periodBars').called('Period').between(2, 400).startingAt(20)
 */
export const Params = {
    integer: integerParameter,
    decimal: decimalParameter,
    choice: choiceParameter,
    toggle: toggleParameter,
} as const;
