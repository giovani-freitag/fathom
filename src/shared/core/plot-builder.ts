import type {
    PlanDraft,
    PlotBand,
    PlotLevel,
    PlotScale,
    PlotSeries,
    PlotShape,
    PlotTone,
} from './draw-plan.ts';
import type { PriceBarWindow } from './price-bar.ts';
import { collectInstants } from './series-math.ts';

/** Values a series can be given, whichever array the arithmetic produced. */
export type PlotValues = ArrayLike<number>;

function toValues(values: PlotValues): Float64Array {
    return values instanceof Float64Array ? values : Float64Array.from(values);
}

/**
 * A plan under construction, bound to the bars its values line up with.
 *
 * Fluent because the raw draft has thirteen fields and an author cares about
 * two; the rest are ways to be wrong quietly. Nothing here is a translation —
 * every method sets a field on the object the host was always going to be
 * given, so anything this does not cover is reachable by writing that object.
 */
export class PlotBuilder {
    private readonly atMs: Float64Array;
    private readonly series: PlotSeries[] = [];
    private readonly bands: PlotBand[] = [];
    private readonly levels: PlotLevel[] = [];
    private isNamingLines = false;
    private ownSummary: string | undefined;
    private ownConvergence: boolean | undefined;

    constructor(bars: PriceBarWindow) {
        this.atMs = collectInstants(bars.bars);
    }

    /**
     * Adds a line.
     *
     * @param values - One per drawn bar. NaN breaks the line rather than bridging.
     * @param label - What the legend calls it.
     * @returns This builder.
     */
    line(values: PlotValues, label = ''): this {
        return this.add('line', values, label);
    }

    /**
     * Adds a histogram.
     *
     * @param values - One per drawn bar.
     * @param label - What the legend calls it.
     * @returns This builder.
     */
    histogram(values: PlotValues, label = ''): this {
        return this.add('histogram', values, label);
    }

    /**
     * Adds a series of marks that are not joined up.
     *
     * For a reading that flips from one side of price to the other: joining the
     * marks draws a stroke through the price at every flip that no reading took.
     *
     * @param values - One per drawn bar.
     * @param label - What the legend calls it.
     * @returns This builder.
     */
    dots(values: PlotValues, label = ''): this {
        return this.add('dot', values, label);
    }

    /**
     * Adds one line per entry, in the order given.
     *
     * @param named - Values by the name each is drawn under.
     * @returns This builder.
     */
    lines(named: Readonly<Record<string, PlotValues>>): this {
        for (const [label, values] of Object.entries(named)) {
            this.add('line', values, label);
        }
        return this;
    }

    /**
     * Colours the series added last.
     *
     * @param tone - A token from the palette, never a CSS colour.
     * @returns This builder.
     */
    in(tone: PlotTone): this {
        return this.reviseLast({ tone });
    }

    /**
     * Draws the series added last as a broken line.
     *
     * @returns This builder.
     */
    dashed(): this {
        return this.reviseLast({ isDashed: true });
    }

    /**
     * Sets how thick the series added last is drawn.
     *
     * @param widthPx - Stroke width.
     * @returns This builder.
     */
    thick(widthPx: number): this {
        return this.reviseLast({ widthPx });
    }

    /**
     * Splits the series added last by side about a baseline.
     *
     * @param baseline - Where it grows from.
     * @returns This builder.
     */
    risingAndFalling(baseline = 0): this {
        return this.reviseLast({ tone: 'bid', negativeTone: 'ask', baseline });
    }

    /**
     * Shades the region between two series.
     *
     * @param upper - Index of the series above.
     * @param lower - Index of the series below.
     * @param tone - What to shade it in. Defaults to the upper series' tone.
     * @returns This builder.
     */
    shading(upper: number, lower: number, tone?: PlotTone): this {
        this.bands.push({
            upperSeriesIndex: upper,
            lowerSeriesIndex: lower,
            tone: tone ?? this.series[upper]?.tone ?? 'phosphor',
        });
        return this;
    }

    /**
     * Draws a horizontal line at a constant value.
     *
     * @param value - Where it sits.
     * @param tone - What to draw it in.
     * @returns This builder.
     */
    at(value: number, tone: PlotTone = 'muted'): this {
        this.levels.push({ value, tone });
        return this;
    }

    /**
     * Writes each series' name at the end of its own line.
     *
     * For a plan whose series only mean anything named — a set of levels says
     * "some above and some below" unless the reader can see which is which.
     *
     * @returns This builder.
     */
    namingEachLine(): this {
        this.isNamingLines = true;
        return this;
    }

    /**
     * Replaces what the legend shows for the knobs.
     *
     * @param summary - What to show instead of the figures the reader turned.
     * @returns This builder.
     */
    summarisedAs(summary: string): this {
        this.ownSummary = summary;
        return this;
    }

    /**
     * States whether the output can be trusted at its left edge.
     *
     * Only for a reading that converges on something other than a bar count —
     * an anchor to find, a session to see turn over.
     *
     * @param hasConverged - Whether the left edge is true.
     * @returns This builder.
     */
    converged(hasConverged: boolean): this {
        this.ownConvergence = hasConverged;
        return this;
    }

    /** Draws it over the chart, on the price's own axis. */
    overThePrice(): PlanDraft {
        return this.finish({ kind: 'price' });
    }

    /** Gives it a band of its own, scaled to what it drew. */
    inItsOwnBand(): PlanDraft {
        return this.finish({ kind: 'auto' });
    }

    /**
     * Gives it a band with fixed bounds.
     *
     * @param low - The floor of the axis.
     * @param high - The ceiling.
     * @returns The finished draft.
     */
    between(low: number, high: number): PlanDraft {
        return this.finish({ kind: 'fixed', low, high });
    }

    /** Gives it a band centred on nought, so equal opposites read alike. */
    aboutZero(): PlanDraft {
        return this.finish({ kind: 'symmetric' });
    }

    /**
     * Puts it along the floor of the price pane, costing the price no height.
     *
     * @param heightRatio - How much of the pane's floor it takes.
     * @returns The finished draft.
     */
    alongTheFloor(heightRatio = 0.2): PlanDraft {
        return this.finish({ kind: 'overlay', heightRatio });
    }

    private add(shape: PlotShape, values: PlotValues, label: string): this {
        // Thrown rather than left to the budget check, which rejects a plan
        // whole and in silence: a series that does not line up with the bars
        // would simply stop drawing with nothing said about why.
        if (values.length !== this.atMs.length) {
            throw new Error(
                `A series needs one value per drawn bar. Got ${values.length} for ${this.atMs.length} bars.`,
            );
        }
        this.series.push({
            label,
            tone: 'phosphor',
            shape,
            atMs: this.atMs,
            value: toValues(values),
        });
        return this;
    }

    private reviseLast(fields: Partial<PlotSeries>): this {
        const last = this.series.length - 1;
        if (last >= 0) {
            this.series[last] = { ...this.series[last]!, ...fields };
        }
        return this;
    }

    private finish(scale: PlotScale): PlanDraft {
        return {
            series: this.series,
            scale,
            ...(this.bands.length > 0 ? { bands: this.bands } : {}),
            ...(this.levels.length > 0 ? { levels: this.levels } : {}),
            ...(this.isNamingLines ? { namesItsSeries: true } : {}),
            ...(this.ownSummary === undefined ? {} : { parameterSummary: this.ownSummary }),
            ...(this.ownConvergence === undefined ? {} : { hasConverged: this.ownConvergence }),
        };
    }
}

/**
 * Starts a plan over a window of bars.
 *
 * @param bars - The window being drawn, which every series lines up with.
 * @returns A builder bound to those instants.
 */
export function plotOver(bars: PriceBarWindow): PlotBuilder {
    return new PlotBuilder(bars);
}
