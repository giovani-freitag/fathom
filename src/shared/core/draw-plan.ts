import type { PriceBarWindow } from './price-bar.ts';

/**
 * Colours an indicator may ask for, as tokens rather than CSS.
 *
 * A token because the host resolves it against the palette in force: a plan that
 * named a colour would be wrong the moment the reader switched theme, and a plan
 * is held between frames.
 */
export type PlotTone = 'bid' | 'ask' | 'amber' | 'phosphor' | 'ink' | 'muted';

export type PlotShape = 'line' | 'histogram';

/**
 * One plotted series, as vertices in data space.
 *
 * Never in pixels. The host owns the only function from a value to a pixel, so
 * a pan re-projects a plan it already holds instead of asking for a new one —
 * which is what keeps author code off the gesture path entirely.
 */
export interface PlotSeries {
    readonly label: string;
    readonly tone: PlotTone;
    readonly shape: PlotShape;
    /** Instants, ascending. Same length as `value`. */
    readonly atMs: Float64Array;
    /** NaN where the series has nothing to say, so a line breaks instead of bridging. */
    readonly value: Float64Array;
}

/**
 * What an indicator returns for one window.
 */
export interface DrawPlan {
    readonly series: readonly PlotSeries[];
    /**
     * Whether the output can be trusted at its left edge.
     *
     * False when the archive could not supply the warm-up the indicator asked
     * for: the first values are then seeded rather than converged, and they look
     * exactly like converged ones.
     */
    readonly hasConverged: boolean;
}

export interface IndicatorInput {
    readonly bars: PriceBarWindow;
    /** Bars at the front that exist only to seed the output. */
    readonly warmupBarCount: number;
}

/**
 * One indicator: a pure function from bars to vertices.
 */
export interface Indicator {
    readonly id: string;
    /** Bars it needs before the drawn window for its output to have converged. */
    readonly warmupBars: number;
    compute(input: IndicatorInput): DrawPlan;
}

/**
 * Limits a plan is held to, whoever produced it.
 *
 * An over-budget plan is rejected whole rather than truncated: half a series is
 * a different claim than the one the author made.
 */
export const PLOT_BUDGET = {
    maximumSeriesCount: 4,
    maximumVerticesPerSeries: 8_192,
} as const;

/**
 * Whether a plan is within what the host will draw.
 *
 * @param plan - The plan to check.
 * @returns True when every series fits the budget.
 */
export function isPlanWithinBudget(plan: DrawPlan): boolean {
    if (plan.series.length > PLOT_BUDGET.maximumSeriesCount) {
        return false;
    }
    return plan.series.every((series) => (
        series.atMs.length === series.value.length
        && series.atMs.length <= PLOT_BUDGET.maximumVerticesPerSeries
    ));
}
