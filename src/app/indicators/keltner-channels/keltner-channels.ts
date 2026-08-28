import {
    type DrawPlan,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type IndicatorSettings,
    type NumericParameter,
    type PlotScale,
    readSetting,
} from '../../../shared/core/draw-plan.ts';
import {
    collectInstants,
    collectTrueRanges,
    createBlankValues,
    fillExponential,
    fillWilder,
    findContinuousSegments,
} from '../shared/series-math.ts';
import { collectSource, SOURCE } from '../shared/bar-source.ts';

const PERIOD_BARS: NumericParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 20,
    minimum: 2,
    maximum: 400,
};

const RANGE_BARS: NumericParameter = {
    name: 'rangeBars',
    kind: 'integer',
    defaultValue: 10,
    minimum: 2,
    maximum: 400,
};

const MULTIPLIER: NumericParameter = {
    name: 'multiplier',
    kind: 'decimal',
    defaultValue: 2,
    minimum: 0.5,
    maximum: 6,
    step: 0.1,
};

/**
 * A band the width of what price has actually been travelling.
 *
 * The same shape as Bollinger's, measured differently and on purpose: those
 * bands widen with the *spread* of the closes, these with the *range* of the
 * bars. A run of gaps and long wicks that all close together barely moves a
 * standard deviation and moves this a great deal, which is the difference
 * between a quiet market and a violent one that ends up where it started.
 */
export class KeltnerChannels implements Indicator {
    readonly id = 'keltner';
    readonly labelKey = 'indicator.keltner';
    readonly scale: PlotScale = { kind: 'price' };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS, RANGE_BARS, MULTIPLIER, SOURCE];

    /**
     * Bars needed before the window for the first drawn value to be true.
     *
     * @param settings - The reader's parameter values.
     * @returns The longer of the two smoothings, which is what has to settle.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return Math.max(readSetting(settings, PERIOD_BARS), readSetting(settings, RANGE_BARS)) * 3;
    }

    /**
     * Draws the middle and the two edges the range puts around it.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns Three lines and the band between the outer two.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const rangeBars = readSetting(input.settings, RANGE_BARS);
        const multiplier = readSetting(input.settings, MULTIPLIER);
        const source = collectSource(bars, input.settings);

        const middle = createBlankValues(bars.length);
        const range = createBlankValues(bars.length);
        const upper = createBlankValues(bars.length);
        const lower = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            fillExponential({ source, periodBars, segment, out: middle });
            fillWilder({ source: collectTrueRanges(bars, segment), periodBars: rangeBars, segment, out: range });

            for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
                const centre = middle[index]!;
                const width = range[index]!;
                if (Number.isNaN(centre) || Number.isNaN(width)) {
                    continue;
                }
                upper[index] = centre + width * multiplier;
                lower[index] = centre - width * multiplier;
            }
        }

        const atMs = collectInstants(bars);
        return {
            indicatorId: this.id,
            labelKey: this.labelKey,
            parameterSummary: `${String(periodBars)}·${String(multiplier)}`,
            scale: this.scale,
            series: [
                { labelKey: 'indicator.keltner.upper', tone: 'ink', shape: 'line', atMs, value: upper, isDashed: true },
                { labelKey: this.labelKey, tone: 'ink', shape: 'line', atMs, value: middle },
                { labelKey: 'indicator.keltner.lower', tone: 'ink', shape: 'line', atMs, value: lower, isDashed: true },
            ],
            bands: [{ tone: 'ink', upperSeriesIndex: 0, lowerSeriesIndex: 2 }],
            hasConverged: input.warmupBarCount >= this.resolveWarmupBars(input.settings),
        };
    }
}

export const KELTNER_CHANNELS = new KeltnerChannels();
