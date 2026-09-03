import type { PriceBar, PriceBarWindow } from './price-bar.ts';

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
/**
 * The colours a copy is identified by, in the order they are handed out.
 *
 * Neither side of the book is in here. Green means buying and red means the
 * offer everywhere else on this chart — the candles, the volume, the delta, the
 * heat ramp, the resistances of a pivot set — so handing one of them to a mean
 * as an identity teaches a reader something false about a line that has no side
 * at all.
 *
 * Five, and a reader with more copies than that gets a colour twice. That is
 * the point where colour has stopped being able to say which line is which, and
 * it is why a plan can write its own names on the chart instead.
 */
export const INSTANCE_TONES: readonly PlotTone[] = [
    'phosphor',
    'amber',
    'violet',
    'cyan',
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
    readonly label: string;
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
 *
 * Only what the arithmetic produced; the host stamps on everything it already
 * knew, so a name or a scale cannot have two answers.
 */
export interface PlanDraft {
    readonly series: readonly PlotSeries[];
    readonly bands?: readonly PlotBand[];
    readonly levels?: readonly PlotLevel[];
    /**
     * Whether each series is written at the end of its own line.
     *
     * For a plan whose series are only meaningful named. A set of levels is
     * the case that forced it: seven lines in three colours, two of them
     * necessarily alike, say "some red ones above and some green ones below"
     * and nothing else — where the reading a floor actually takes is that
     * price is testing R2 and not R3. Almost nothing else wants it, because a
     * mean and its channel are told apart by where they are.
     */
    readonly namesItsSeries?: boolean;
    /**
     * Whether the output can be trusted at its left edge.
     *
     * Defaulted by the host to whether the warm-up asked for arrived. Declared
     * here only where a reading converges on something else — an anchor to
     * find, a session to see turn over.
     */
    readonly hasConverged?: boolean;
    /**
     * The knobs as the legend should show them.
     *
     * Defaulted by the host to the figures the reader turned. Declared here
     * only where the useful summary is not those.
     */
    readonly parameterSummary?: string;
    /**
     * The axis this window's values belong on.
     *
     * Defaulted by the host to the one the indicator declared. Declared here
     * only where the axis depends on how the reading was tuned.
     */
    readonly scale?: PlotScale;
}

/**
 * A draft with everything the host knows stamped on.
 *
 * What the painters are given, and what a reader's controls reach.
 */
export interface DrawPlan extends PlanDraft {
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
    readonly label: string;
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
    readonly hasConverged: boolean;
}

/**
 * A knob that takes a figure.
 */
export interface NumericParameter {
    readonly name: string;
    /** What the control is called. Absent falls back to a key built from the name. */
    readonly label?: string;
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
    /** What the control is called. Absent falls back to a key built from the name. */
    readonly label?: string;
    readonly kind: 'choice';
    readonly defaultValue: string;
    readonly choices: readonly string[];
}

/**
 * A knob that is either on or off.
 */
export interface ToggleParameter {
    readonly name: string;
    /** What the control is called. Absent falls back to a key built from the name. */
    readonly label?: string;
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
 * A coarser session an indicator also reads, and how far back it needs them.
 *
 * The reach is in sessions of the rung asked for, not bars of the one drawn:
 * fifty daily closes is fifty days on a minute chart and on an hourly one.
 */
export interface SessionRequest {
    readonly intervalMs: number;
    /** Settled sessions needed before the window opens. */
    readonly reachingBack: number;
}

/**
 * Everything besides the drawn bars a reading needs, for the host to fetch.
 *
 * One method rather than one per kind: it is one question, and the host merges
 * every answer on the chart in a single pass.
 */
export interface SourceRequest {
    /** Bars before the drawn window, on the drawn rung. */
    readonly warmupBars?: number;
    /**
     * Coarser sessions, keyed by the name `compute` reads them back under.
     *
     * Named rather than keyed by the figure asked with, so declaring and
     * looking one up is the same string.
     */
    readonly sessions?: Readonly<Record<string, SessionRequest>>;
}

/**
 * A coarser rung, aligned to the drawn bars and held back to what each knew.
 *
 * Aligned rather than handed over whole because there is then no index that
 * reaches a session a drawn bar could not have seen.
 */
export interface SettledSessions {
    /** False where no session had closed by any drawn bar. */
    readonly hasAny: boolean;
    /**
     * One entry per drawn bar: the newest session that had closed by its open.
     *
     * Undefined at the left edge, before anything had settled.
     */
    readonly perBar: readonly (PriceBar | undefined)[];
    /** 1 where a drawn bar is the first after the session turned over. */
    readonly turnsOver: Uint8Array;
}

/** What a reading with no sessions declared is handed under any name. */
export const NO_SESSIONS: SettledSessions = {
    hasAny: false,
    perBar: [],
    turnsOver: new Uint8Array(0),
};

export interface IndicatorInput {
    readonly bars: PriceBarWindow;
    readonly settings: IndicatorSettings;
    /**
     * The coarser sessions declared, by name.
     *
     * Plain data so the whole input survives being sent to a worker, which
     * strips the prototype off anything carrying methods.
     */
    readonly sessions: Readonly<Record<string, SettledSessions>>;
}

/**
 * A declared session, by name.
 *
 * @param input - What the reading was handed.
 * @param name - The key the session was declared under.
 * @returns The sessions, held back to what each drawn bar could know.
 * @throws Error when nothing was declared under that name, which is louder
 *     than the flat line an empty one would draw.
 */
export function readSessions(input: IndicatorInput, name: string): SettledSessions {
    const found = input.sessions[name];
    if (found === undefined) {
        const declared = Object.keys(input.sessions);
        const names = declared.length === 0 ? '(none)' : declared.join(', ');
        throw new Error(`No session was declared under '${name}'. Declared: ${names}.`);
    }

    return found;
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
    readonly label: string;
    /** One line for the palette. A phrase, or a key naming one. */
    readonly about?: string;
    readonly parameters: readonly IndicatorParameter[];
}

/**
 * Anything a reader can add, paired with the id it is stored and found under.
 *
 * On the entry rather than on the reading, so the catalogue is the one place a
 * name is claimed and two readings cannot claim the same one.
 */
export interface Registered<T> {
    readonly id: string;
    readonly layer: T;
}

export interface Indicator {
    /**
     * What the reading is called.
     *
     * A phrase, or a key naming one: unmatched keys render as written, so a
     * reading can ship a name without shipping a translation.
     */
    readonly label: string;
    /** One line for the palette. A phrase, or a key naming one. */
    readonly about?: string;
    readonly scale: PlotScale;
    /** Whether what it draws is told by its colour, so a copy cannot be tinted. */
    readonly isSelfColoured?: boolean;
    readonly parameters: readonly IndicatorParameter[];
    /** Everything besides the drawn bars this reads. Absent means the bars alone. */
    resolveSources?(settings: IndicatorSettings): SourceRequest;
    compute(input: IndicatorInput): PlanDraft;
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
 * @param plan - The draft to check.
 * @returns True when every series fits the budget and every reference resolves.
 */
export function isPlanWithinBudget(plan: PlanDraft): boolean {
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
 * The bars a reading needs before the drawn window.
 *
 * @param indicator - The reading being asked.
 * @param settings - Values the reader chose.
 * @returns The count, or none where it declared no sources at all.
 */
export function resolveWarmupBars(indicator: Indicator, settings: IndicatorSettings): number {
    return indicator.resolveSources?.(settings).warmupBars ?? 0;
}

/** What the host completes a draft with. */
export interface PlanStamp {
    /** The id the copy was added under. */
    readonly indicatorId: string;
    readonly indicator: Indicator;
    readonly settings: IndicatorSettings;
    /** Bars of warm-up the archive actually supplied. */
    readonly warmupBarCount: number;
}

/**
 * Completes a draft with everything the host already knew.
 *
 * @param stamp - Who asked, how it was tuned, and what warm-up arrived.
 * @param draft - What the arithmetic produced.
 * @returns The plan the painters are given.
 */
export function completePlan(stamp: PlanStamp, draft: PlanDraft): DrawPlan {
    const { indicator, settings } = stamp;

    return {
        ...draft,
        indicatorId: stamp.indicatorId,
        label: indicator.label,
        parameterSummary: draft.parameterSummary
            ?? summariseParameters(indicator.parameters, settings),
        scale: draft.scale ?? indicator.scale,
        ...(indicator.isSelfColoured === true ? { isSelfColoured: true } : {}),
        hasConverged: draft.hasConverged
            ?? stamp.warmupBarCount >= resolveWarmupBars(indicator, settings),
    };
}

/**
 * The knobs a legend shows, for a plan that did not say.
 *
 * Figures only: a choice is usually what a reading is rather than how it was
 * tuned, and the name already says it.
 *
 * @param parameters - The knobs the indicator declared.
 * @param settings - Values the reader chose.
 * @returns The figures, in declaration order, or an empty string where none.
 */
export function summariseParameters(
    parameters: readonly IndicatorParameter[],
    settings: IndicatorSettings,
): string {
    const figures: string[] = [];
    for (const parameter of parameters) {
        if (parameter.kind === 'integer' || parameter.kind === 'decimal') {
            figures.push(String(readSetting(settings, parameter)));
        }
    }

    return figures.join(' \u00b7 ');
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
