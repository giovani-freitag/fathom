import {
    type ChoiceParameter,
    type DrawPlan,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type PlotScale,
    type PlotSeries,
    readChoice,
} from '../../shared/core/draw-plan.ts';
import { collectInstants, createBlankValues } from './series-math.ts';
import type { PriceBar } from '../../shared/core/price-bar.ts';

/**
 * How much is shown.
 *
 * Declared here and turned in the book's own card: how much traded is the
 * recording seen another way, so it is tuned where the recording is.
 */
const MODE: ChoiceParameter = {
    name: 'mode',
    kind: 'choice',
    defaultValue: 'total',
    choices: ['total', 'sides'],
};

/**
 * How much changed hands in each bar.
 *
 * Offered two ways because the recording knows something a tape of prints does
 * not: which side crossed the spread. The total is what a reader expects to
 * see; the split is what this archive can say that others cannot.
 */
export class Volume implements Indicator {
    readonly id = 'volume';
    readonly labelKey = 'indicator.volume';
    /**
     * A strip along the floor of the price pane.
     *
     * Where a reader expects to find it, and it costs the price no height —
     * only some of the floor it was not reading anyway.
     */
    readonly scale: PlotScale = { kind: 'overlay', heightRatio: 0.2 };
    readonly parameters: readonly IndicatorParameter[] = [MODE];

    /**
     * Bars needed before the window, which is none.
     *
     * Each bar carries its own count; nothing is smoothed and nothing is seeded.
     *
     * @returns One, the smallest a window can be asked for.
     */
    resolveWarmupBars(): number {
        return 1;
    }

    /**
     * Draws what traded in each bar, whole or split by side.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns One histogram, or one either side of nought.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const atMs = collectInstants(bars);
        const isSplit = readChoice(input.settings, MODE) === 'sides';

        return {
            indicatorId: this.id,
            labelKey: this.labelKey,
            parameterSummary: '',
            // Split, it reads as a balance rather than a size, so it is centred
            // on nought and given a band: two directions need room, and a strip
            // along the floor has none to give.
            scale: isSplit ? { kind: 'symmetric' } : this.scale,
            series: isSplit ? buildSplit(bars, atMs) : buildTotal(bars, atMs),
            levels: isSplit ? [{ value: 0, tone: 'muted' }] : [],
            // Nothing is carried between bars, so there is nothing to converge.
            hasConverged: true,
        };
    }
}

/**
 * The total, in two series that between them cover every bar.
 *
 * A bar is coloured by where its own price ended up, which is the convention
 * everywhere and the thing a reader is comparing the size against. Two series
 * rather than a colour per bar: a gap in one is already how a series says it
 * has nothing to say at an instant, and the other says it there instead.
 */
function buildTotal(bars: readonly PriceBar[], atMs: Float64Array): PlotSeries[] {
    const rising = createBlankValues(bars.length);
    const falling = createBlankValues(bars.length);

    for (let index = 0; index < bars.length; index += 1) {
        const bar = bars[index]!;
        const total = bar.buyVolume + bar.sellVolume;
        if (bar.closePrice >= bar.openPrice) {
            rising[index] = total;
            continue;
        }
        falling[index] = total;
    }

    return [
        { labelKey: 'indicator.volume.rising', tone: 'bid', shape: 'histogram', baseline: 0, atMs, value: rising },
        { labelKey: 'indicator.volume.falling', tone: 'ask', shape: 'histogram', baseline: 0, atMs, value: falling },
    ];
}

function buildSplit(bars: readonly PriceBar[], atMs: Float64Array): PlotSeries[] {
    const bought = new Float64Array(bars.length);
    const sold = new Float64Array(bars.length);
    for (let index = 0; index < bars.length; index += 1) {
        const bar = bars[index]!;
        bought[index] = bar.buyVolume;
        // Drawn downward, so the two sides are read against each other rather
        // than stacked into a total that hides which way the balance went.
        sold[index] = -bar.sellVolume;
    }

    return [
        { labelKey: 'indicator.volume.bought', tone: 'bid', shape: 'histogram', baseline: 0, atMs, value: bought },
        { labelKey: 'indicator.volume.sold', tone: 'ask', shape: 'histogram', baseline: 0, atMs, value: sold },
    ];
}

export const VOLUME = new Volume();
