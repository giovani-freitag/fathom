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
    smoothWilder,
} from './series-math.ts';

const PERIOD_BARS: IndicatorParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 14,
    minimum: 2,
    maximum: 200,
};

/**
 * How far price has been travelling per bar, in the instrument's own units.
 */
export class AverageTrueRange implements Indicator {
    readonly id = 'atr';
    readonly labelKey = 'indicator.atr';
    readonly scale: PlotScale = { kind: 'auto' };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS];

    /**
     * Bars needed before the window for the smoothed range to have settled.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return readSetting(settings, PERIOD_BARS) * 3;
    }

    /**
     * Smooths the per-bar travel into one line.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns One line on a scale of its own.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const value = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            let average = Number.NaN;
            for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
                const bar = bars[index]!;
                const previousClose = index === segment.startIndex
                    ? bar.openPrice
                    : bars[index - 1]!.closePrice;
                const trueRange = Math.max(
                    bar.highPrice - bar.lowPrice,
                    Math.abs(bar.highPrice - previousClose),
                    Math.abs(bar.lowPrice - previousClose),
                );
                average = Number.isNaN(average)
                    ? trueRange
                    : smoothWilder(average, trueRange, periodBars);
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
                tone: 'amber',
                shape: 'line',
                atMs: collectInstants(bars),
                value,
            }],
            hasConverged: input.warmupBarCount >= this.resolveWarmupBars(input.settings),
        };
    }
}

export const AVERAGE_TRUE_RANGE = new AverageTrueRange();
