import type { PriceBarWindow } from './price-bar.ts';

/**
 * Colours an indicator may ask for, as tokens rather than CSS.
 *
 * A token because the host resolves it against the palette in force: a plan that
 * named a colour would be wrong the moment the reader switched theme, and a plan
 * is held between frames.
 */
export type PlotTone =
    | 'bid'
    | 'ask'
    | 'amber'
    | 'phosphor'
    | 'violet'
    | 'cyan'
    | 'ink'
    | 'muted';

/**
 * The tones one added copy can be given to tell it from another.
 *
 * A subset rather than the whole list: `bid` sits too close to `phosphor` to
 * separate two lines crossing each other, and `muted` is what an accent is
 * drawn in, so neither can carry an identity.
 */
export const INSTANCE_TONES: readonly PlotTone[] = [
    'phosphor',
    'amber',
    'violet',
    'cyan',
    'ask',
    'ink',
];

export type PlotShape = 'line' | 'histogram';

/**
 * One plotted series, as vertices in data space.
 *
 * Never in pixels. The host owns the only function from a value to a pixel, so
 * a pan re-projects a plan it already holds instead of asking for a new one —
 * which is what keeps author code off the gesture path entirely.
 */
export interface PlotSeries {
    /**
     * Names the series in the legend.
     *
     * Resolved against the catalogue when it matches an entry and rendered as
     * written when it does not, so an addon can ship a label the host has never
     * heard of without shipping a translation for it.
     */
    readonly labelKey: string;
    readonly tone: PlotTone;
    readonly shape: PlotShape;
    /** Instants, ascending. Same length as `value`. */
    readonly atMs: Float64Array;
    /** NaN where the series has nothing to say, so a line breaks instead of bridging. */
    readonly value: Float64Array;
    /** Used below `baseline`. Absent means one colour throughout. */
    readonly negativeTone?: PlotTone;
    /** Where a histogram grows from. Ignored by lines. */
    readonly baseline?: number;
    readonly widthPx?: number;
    readonly isDashed?: boolean;
}

/**
 * A shaded region between two of the plan's series.
 */
export interface PlotBand {
    readonly tone: PlotTone;
    readonly upperSeriesIndex: number;
    readonly lowerSeriesIndex: number;
}

/**
 * A horizontal line at a constant value.
 */
export interface PlotLevel {
    readonly value: number;
    readonly tone: PlotTone;
    readonly isDashed?: boolean;
}

/**
 * Which vertical scale a plan is drawn against.
 *
 * `price` puts it over the chart. The rest give it a pane of its own, because a
 * quantity that is not a price cannot share an axis with one: an oscillator
 * bounded to 0..100 plotted against a price axis is a flat line at the bottom.
 */
export type PlotScale =
    | { readonly kind: 'price' }
    | { readonly kind: 'auto' }
    | { readonly kind: 'fixed'; readonly low: number; readonly high: number }
    | { readonly kind: 'symmetric' };

/**
 * What an indicator returns for one window.
 */
export interface DrawPlan {
    readonly indicatorId: string;
    /**
     * Which added copy produced it, stamped by the host rather than the author.
     *
     * An indicator has no idea how many times a reader has added it, and the
     * controls over a plan have to reach the one copy they belong to.
     */
    readonly instanceId?: string;
    readonly labelKey: string;
    /** The parameters that produced it, as the legend shows them. */
    readonly parameterSummary: string;
    readonly scale: PlotScale;
    readonly series: readonly PlotSeries[];
    readonly bands?: readonly PlotBand[];
    readonly levels?: readonly PlotLevel[];
    /**
     * Whether the output can be trusted at its left edge.
     *
     * False when the archive could not supply the warm-up the indicator asked
     * for: the first values are then seeded rather than converged, and they look
     * exactly like converged ones.
     */
    readonly hasConverged: boolean;
}

export type IndicatorParameterKind = 'integer' | 'decimal';

/**
 * One knob an indicator exposes, described well enough to build a control from.
 */
export interface IndicatorParameter {
    readonly name: string;
    readonly kind: IndicatorParameterKind;
    readonly defaultValue: number;
    readonly minimum: number;
    readonly maximum: number;
}

/** Parameter values by name. */
export type IndicatorSettings = Readonly<Record<string, number>>;

export interface IndicatorInput {
    readonly bars: PriceBarWindow;
    /** Bars at the front that exist only to seed the output. */
    readonly warmupBarCount: number;
    readonly settings: IndicatorSettings;
}

/**
 * One indicator: a description of its knobs, and a pure function from bars to vertices.
 *
 * Stateless on purpose. The settings arrive with the call rather than with a
 * constructor, so the same object serves every copy a reader has added and
 * nothing has to be rebuilt when one of them is retuned.
 */
export interface Indicator {
    readonly id: string;
    readonly labelKey: string;
    readonly scale: PlotScale;
    readonly parameters: readonly IndicatorParameter[];
    /** Bars it needs before the drawn window for its output to have converged. */
    resolveWarmupBars(settings: IndicatorSettings): number;
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
 * @returns True when every series fits the budget and every reference resolves.
 */
export function isPlanWithinBudget(plan: DrawPlan): boolean {
    if (plan.series.length > PLOT_BUDGET.maximumSeriesCount) {
        return false;
    }
    const isSeriesSound = plan.series.every((series) => (
        series.atMs.length === series.value.length
        && series.atMs.length <= PLOT_BUDGET.maximumVerticesPerSeries
    ));

    return isSeriesSound && (plan.bands ?? []).every((band) => (
        band.upperSeriesIndex < plan.series.length && band.lowerSeriesIndex < plan.series.length
    ));
}

/**
 * Reads a setting, falling back to what the indicator declared.
 *
 * @param settings - Values the reader chose.
 * @param parameter - The knob being read.
 * @returns The value, clamped to the declared range and rounded when integral.
 */
export function readSetting(settings: IndicatorSettings, parameter: IndicatorParameter): number {
    const chosen = settings[parameter.name] ?? parameter.defaultValue;
    const clamped = Math.min(parameter.maximum, Math.max(parameter.minimum, chosen));
    return parameter.kind === 'integer' ? Math.round(clamped) : clamped;
}

/**
 * The tone a plan is identified by.
 *
 * The first line rather than the first series: a histogram is drawn first so it
 * sits under everything, but what a reader points at when they say "the MACD"
 * is the line, and that is what the legend's mark should match.
 */
function resolveOwnTone(plan: DrawPlan): PlotTone | undefined {
    const line = plan.series.find((series) => series.shape === 'line');
    return (line ?? plan.series[0])?.tone;
}

/**
 * Recolours a plan to the tone its copy was given.
 *
 * Only what was drawn in the indicator's own colour moves. A tone the author
 * chose to differ — a dashed midline, a signal line, the shading of a band —
 * is an accent that says something about the reading, and flattening those into
 * one colour would lose what the author was distinguishing.
 *
 * @param plan - What the indicator produced.
 * @param tone - The colour this copy is identified by.
 * @returns The plan, with its own colour replaced.
 */
export function recolourPlan(plan: DrawPlan, tone: PlotTone): DrawPlan {
    const own = resolveOwnTone(plan);
    if (own === undefined || own === tone) {
        return plan;
    }

    const bands = plan.bands === undefined
        ? {}
        : { bands: plan.bands.map((band) => (band.tone === own ? { ...band, tone } : band)) };

    return {
        ...plan,
        ...bands,
        series: plan.series.map((series) => (
            series.tone === own ? { ...series, tone } : series
        )),
    };
}

/**
 * The value a series carried at an instant.
 *
 * The bar the instant falls in rather than the nearest vertex: a reading
 * belongs to the bucket it was computed over, and rounding to the closer
 * neighbour would show the next bar's value for half of this one.
 *
 * @param series - The series to read.
 * @param atMs - The instant asked about.
 * @returns The value, or NaN where the series says nothing there.
 */
export function readValueAt(series: PlotSeries, atMs: number): number {
    let low = 0;
    let high = series.atMs.length - 1;
    let found = -1;

    while (low <= high) {
        const middle = (low + high) >> 1;
        if (series.atMs[middle]! <= atMs) {
            found = middle;
            low = middle + 1;
            continue;
        }
        high = middle - 1;
    }

    return found === -1 ? Number.NaN : series.value[found]!;
}
