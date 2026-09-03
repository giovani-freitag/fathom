import {
    type PlanDraft,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type IndicatorSettings,
    type NumericParameter,
    type PlotScale,
    readSetting,
} from '../../../shared/core/draw-plan.ts';
import {
    type BarSegment,
    collectInstants,
    createBlankValues,
    findContinuousSegments,
} from '../shared/series-math.ts';
import type { PriceBar } from '../../../shared/core/price-bar.ts';

const PERIOD_BARS: NumericParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 20,
    minimum: 2,
    maximum: 400,
};

/**
 * Scales the reading so that most of it falls inside plus or minus a hundred.
 *
 * Lambert's constant, kept because the thresholds everyone reads this against
 * are the thresholds it produces.
 */
const LAMBERT_SCALE = 0.015;

/** Where the reading is conventionally read as stretched. */
const STRETCHED = 100;

/**
 * How far price has wandered from its own recent average, in units of how far it usually wanders.
 *
 * Unbounded on purpose, which is what separates it from the oscillators that
 * are pinned to nought and a hundred: those flatten against their ceiling for
 * the whole of a strong move and stop saying anything, and this goes on rising.
 * The spread it is divided by is the mean distance from the average rather than
 * the standard deviation, so one violent bar cannot widen it the way squaring
 * would.
 */
export class CommodityChannel implements Indicator {
    readonly label = 'indicator.cci';
    readonly about = 'indicator.cci.help';
    readonly scale: PlotScale = { kind: 'symmetric' };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS];

    /**
     * Bars needed before the window for the first drawn value to be true.
     *
     * @param settings - The reader's parameter values.
     * @returns The window it averages over.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return readSetting(settings, PERIOD_BARS);
    }

    /**
     * Measures each bar's distance from the recent average against the usual distance.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns One line, with the two conventional thresholds marked.
     */
    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const value = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            fillChannel({ bars, segment, periodBars, out: value });
        }

        return {
            series: [{
                label: this.label,
                tone: 'violet',
                shape: 'line',
                atMs: collectInstants(bars),
                value,
            }],
            levels: [
                { value: STRETCHED, tone: 'muted', isDashed: true },
                { value: 0, tone: 'muted', isDashed: true },
                { value: -STRETCHED, tone: 'muted', isDashed: true },
            ],
        };
    }
}

interface ChannelFill {
    readonly bars: readonly PriceBar[];
    readonly segment: BarSegment;
    readonly periodBars: number;
    readonly out: Float64Array;
}

/**
 * Walks the window along the stretch, taking the average and the spread about it.
 */
function fillChannel(fill: ChannelFill): void {
    const { bars, segment, periodBars, out } = fill;
    const { startIndex, endIndex } = segment;

    const typical = createBlankValues(bars.length);
    for (let index = startIndex; index < endIndex; index += 1) {
        const bar = bars[index]!;
        typical[index] = (bar.highPrice + bar.lowPrice + bar.closePrice) / 3;
    }

    for (let index = startIndex + periodBars - 1; index < endIndex; index += 1) {
        const from = index - periodBars + 1;
        let total = 0;
        for (let back = from; back <= index; back += 1) {
            total += typical[back]!;
        }
        const average = total / periodBars;

        let spread = 0;
        for (let back = from; back <= index; back += 1) {
            spread += Math.abs(typical[back]! - average);
        }
        spread /= periodBars;

        // A window whose bars all read the same has no spread to divide by, and
        // price is exactly on its average rather than infinitely far from it.
        out[index] = spread === 0 ? 0 : (typical[index]! - average) / (LAMBERT_SCALE * spread);
    }
}

export const COMMODITY_CHANNEL = new CommodityChannel();
