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

/** Every tone a plan may name. */
export const PLOT_TONES: readonly PlotTone[] = [
    'bid',
    'ask',
    'amber',
    'phosphor',
    'violet',
    'cyan',
    'ink',
    'muted',
];

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

/**
 * How a series is drawn.
 *
 * `dot` is not a thin line. A reading that flips from one side of price to the
 * other says so by where its marks sit, and joining them up draws a stroke
 * through the price at every flip that no reading ever took.
 */
export type PlotShape = 'line' | 'histogram' | 'dot';

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
 * `price` puts it over the chart on the price's own axis. `overlay` puts it
 * along the bottom of the same pane on a scale of its own. The rest give it a
 * band, because a quantity that is not a price cannot share an axis with one:
 * an oscillator bounded to 0..100 plotted against a price axis is a flat line
 * at the bottom of the screen.
 */
export type PlotScale =
    | { readonly kind: 'price' }
    /**
     * A strip along the bottom of the price pane, on a scale of its own.
     *
     * For a reading that belongs beside the price without being one and without
     * being worth a band: it costs the price no height, only some of its floor.
     */
    | { readonly kind: 'overlay'; readonly heightRatio: number }
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
    /**
     * Which band it shares, stamped by the host rather than the author.
     *
     * An indicator has no idea what else is on the chart, and whether two
     * readings belong side by side is the reader's judgement, not its own.
     */
    readonly bandKey?: string;
    /**
     * What it was produced from, stamped by the host rather than the author.
     *
     * The drawn layer is held between frames and repainted only when its
     * description changes. A recolour or a different source changes the
     * drawing and nothing else about it, so without this the canvas keeps
     * showing the previous one.
     */
    readonly tuning?: string;
    readonly labelKey: string;
    /** The parameters that produced it, as the legend shows them. */
    readonly parameterSummary: string;
    readonly scale: PlotScale;
    /**
     * Whether the plan's own colours carry a reading rather than an identity.
     *
     * Volume is drawn green and red because the bar rose or fell, not because
     * it is the first copy on the chart. Painting such a plan in the colour a
     * copy is identified by would say something untrue about the data.
     */
    readonly isSelfColoured?: boolean;
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

/**
 * A knob that takes a figure.
 */
export interface NumericParameter {
    readonly name: string;
    readonly kind: 'integer' | 'decimal';
    readonly defaultValue: number;
    readonly minimum: number;
    readonly maximum: number;
    /**
     * How far one nudge moves it.
     *
     * Declared where the useful travel is not spread evenly across the range:
     * the upper cut of the depth map lives in its last percent, and a step
     * sized to the whole range would offer two positions inside it.
     */
    readonly step?: number;
}

/**
 * A knob that takes one of a fixed set of answers.
 */
export interface ChoiceParameter {
    readonly name: string;
    readonly kind: 'choice';
    readonly defaultValue: string;
    readonly choices: readonly string[];
}

/**
 * A knob that is either on or off.
 */
export interface ToggleParameter {
    readonly name: string;
    readonly kind: 'toggle';
    readonly defaultValue: boolean;
}

export type IndicatorParameter = NumericParameter | ChoiceParameter | ToggleParameter;

/** Anything with knobs a reader can turn, whoever draws it. */
export interface Tunable {
    readonly parameters: readonly IndicatorParameter[];
}

/** Parameter values by name. */
export type IndicatorSettings = Readonly<Record<string, number | string | boolean>>;

/**
 * A coarser rung an indicator also reads, and how far back it needs it.
 *
 * The warm-up is counted in bars of the rung being asked for, not in bars of
 * the one being drawn. An average of fifty daily closes wants fifty days
 * whether it is drawn on a minute chart or an hourly one, and a warm-up
 * inherited from the drawn rung would fetch fifty minutes or four years.
 */
export interface HigherBarRequest {
    readonly intervalMs: number;
    /** Bars of that rung needed before the window opens. */
    readonly warmupBars: number;
}

/**
 * The coarser windows an indicator asked for, keyed by the rung.
 *
 * A lookup rather than a list, because an indicator that asked for two rungs
 * has to be able to tell them apart, and it already knows the numbers it asked
 * with. Missing rather than empty when the host could not supply one: a venue
 * publishes no candle for every rung, and a reading drawn from bars that were
 * never fetched would be a reading about nothing.
 */
export class HigherBars {
    private readonly windows: ReadonlyMap<number, PriceBarWindow>;

    constructor(windows: Iterable<PriceBarWindow> = []) {
        this.windows = new Map([...windows].map((window) => [window.intervalMs, window]));
    }

    /**
     * The window on one rung.
     *
     * @param intervalMs - The rung, as it was asked for.
     * @returns The bars, or null where the host had none to give.
     */
    at(intervalMs: number): PriceBarWindow | null {
        return this.windows.get(intervalMs) ?? null;
    }
}

/** What an indicator that reads only the drawn rung is handed. */
export const NO_HIGHER_BARS = new HigherBars();

export interface IndicatorInput {
    readonly bars: PriceBarWindow;
    /** Bars at the front that exist only to seed the output. */
    readonly warmupBarCount: number;
    /** Coarser rungs, for an indicator that declared it reads any. */
    readonly higher: HigherBars;
    readonly settings: IndicatorSettings;
}

/**
 * One indicator: a description of its knobs, and a pure function from bars to vertices.
 *
 * Stateless on purpose. The settings arrive with the call rather than with a
 * constructor, so the same object serves every copy a reader has added and
 * nothing has to be rebuilt when one of them is retuned.
 */
/**
 * A layer the host draws itself, rather than one built from arithmetic.
 *
 * The depth map is the reason this exists. It is a picture of hundreds of
 * thousands of cells built from the book, not a handful of vertices built from
 * bars, and it is painted on a layer of its own so that dragging the chart is a
 * blit rather than a repaint. None of that fits what an indicator returns.
 *
 * What it does share with an indicator is everything the reader touches: it is
 * added, tuned, hidden and removed the same way, from the same list.
 */
export interface FieldLayer {
    readonly id: string;
    readonly labelKey: string;
    readonly parameters: readonly IndicatorParameter[];
}

export interface Indicator {
    readonly id: string;
    readonly labelKey: string;
    readonly scale: PlotScale;
    /** Whether what it draws is told by its colour, so a copy cannot be tinted. */
    readonly isSelfColoured?: boolean;
    readonly parameters: readonly IndicatorParameter[];
    /** Bars it needs before the drawn window for its output to have converged. */
    resolveWarmupBars(settings: IndicatorSettings): number;
    /**
     * Coarser rungs it also reads, for the host to fetch alongside.
     *
     * Absent on almost every reading, which is why it is optional: an indicator
     * is a function of the bars it is drawn on until it says otherwise.
     */
    resolveHigherIntervals?(settings: IndicatorSettings): readonly HigherBarRequest[];
    compute(input: IndicatorInput): DrawPlan;
}

/**
 * Limits a plan is held to, whoever produced it.
 *
 * An over-budget plan is rejected whole rather than truncated: half a series is
 * a different claim than the one the author made.
 *
 * The series cap was four while every reading here was a line, a pair of them,
 * or a line with a band. A set of levels is neither: a pivot set is seven lines
 * that only mean anything together, and drawing three of them is not a smaller
 * version of the reading. Eight is that set with room to spare, and still few
 * enough that the legend stays a legend.
 */
export const PLOT_BUDGET = {
    maximumSeriesCount: 8,
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
 * Reads a figure, falling back to what the indicator declared.
 *
 * Clamped rather than trusted: a setting outlives the control that produced it,
 * so a figure no current control could produce still has to arrive safely.
 *
 * @param settings - Values the reader chose.
 * @param parameter - The knob being read.
 * @returns The value, clamped to the declared range and rounded when integral.
 */
export function readSetting(settings: IndicatorSettings, parameter: NumericParameter): number {
    const chosen = settings[parameter.name];
    const wanted = typeof chosen === 'number' ? chosen : parameter.defaultValue;
    const clamped = Math.min(parameter.maximum, Math.max(parameter.minimum, wanted));
    return parameter.kind === 'integer' ? Math.round(clamped) : clamped;
}

/**
 * Reads a switch, falling back to what the indicator declared.
 *
 * @param settings - Values the reader chose.
 * @param parameter - The knob being read.
 * @returns Whether it is on.
 */
export function readToggle(settings: IndicatorSettings, parameter: ToggleParameter): boolean {
    const chosen = settings[parameter.name];
    return typeof chosen === 'boolean' ? chosen : parameter.defaultValue;
}

/**
 * Reads a choice, falling back to what the indicator declared.
 *
 * @param settings - Values the reader chose.
 * @param parameter - The knob being read.
 * @returns One of the declared choices.
 */
export function readChoice(settings: IndicatorSettings, parameter: ChoiceParameter): string {
    const chosen = settings[parameter.name];
    return typeof chosen === 'string' && parameter.choices.includes(chosen)
        ? chosen
        : parameter.defaultValue;
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
 * A plan that says its colours are a reading is left alone. Otherwise only what
 * was drawn in the indicator's own colour moves: a tone the author chose to
 * differ — a dashed midline, a signal line, the shading of a band —
 * is an accent that says something about the reading, and flattening those into
 * one colour would lose what the author was distinguishing.
 *
 * @param plan - What the indicator produced.
 * @param tone - The colour this copy is identified by.
 * @returns The plan, with its own colour replaced.
 */
export function recolourPlan(plan: DrawPlan, tone: PlotTone): DrawPlan {
    if (plan.isSelfColoured === true) {
        return plan;
    }

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
