import {
    type DrawPlan,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type IndicatorSettings,
    type PlotScale,
    readSetting,
} from '../../shared/core/draw-plan.ts';
import {
    collectInstants,
    createBlankValues,
    findContinuousSegments,
    resolveExponentialWeight,
} from './series-math.ts';

const PERIOD_BARS: IndicatorParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 20,
    minimum: 2,
    maximum: 400,
};

/**
 * Bars of warm-up an average of this period needs before it has converged.
 *
 * At a smoothing factor of 2/(n+1), the seed still carries 13.5% of the weight
 * after n bars. Two and a bit periods brings that under a percent, which is the
 * point at which a reader comparing two screens stops seeing a difference.
 */
export function resolveWarmupBars(periodBars: number): number {
    return Math.max(1, Math.ceil(periodBars * 2.3));
}

/**
 * The exponential moving average of the bar close.
 */
export class ExponentialAverage implements Indicator {
    readonly id = 'ema';
    readonly labelKey = 'indicator.ema';
    readonly scale: PlotScale = { kind: 'price' };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS];

    /**
     * Bars needed before the window for the seed to have washed out.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return resolveWarmupBars(readSetting(settings, PERIOD_BARS));
    }

    /**
     * Smooths the closes of a window into one line.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns One line, restarting wherever the recording was interrupted.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const weight = resolveExponentialWeight(periodBars);
        const value = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            let average = bars[segment.startIndex]!.closePrice;
            for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
                const closePrice = bars[index]!.closePrice;
                average = index === segment.startIndex
                    ? closePrice
                    : average + weight * (closePrice - average);
                value[index] = average;
            }
        }

        return {
            indicatorId: this.id,
            labelKey: this.labelKey,
            parameterSummary: String(periodBars),
            scale: this.scale,
            series: [{
                labelKey: this.labelKey,
                tone: 'phosphor',
                shape: 'line',
                atMs: collectInstants(bars),
                value,
            }],
            hasConverged: input.warmupBarCount >= resolveWarmupBars(periodBars),
        };
    }
}

export const EXPONENTIAL_AVERAGE = new ExponentialAverage();
