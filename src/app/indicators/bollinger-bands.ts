import {
    type DrawPlan,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type IndicatorSettings,
    type PlotScale,
    readSetting,
} from '../../shared/core/draw-plan.ts';
import { collectInstants, createBlankValues, findContinuousSegments } from './series-math.ts';

const PERIOD_BARS: IndicatorParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 20,
    minimum: 2,
    maximum: 400,
};

const DEVIATIONS: IndicatorParameter = {
    name: 'deviations',
    kind: 'decimal',
    defaultValue: 2,
    minimum: 0.5,
    maximum: 5,
};

/**
 * A moving average with a channel scaled to how much the close has been moving.
 */
export class BollingerBands implements Indicator {
    readonly id = 'bollinger';
    readonly labelKey = 'indicator.bollinger';
    readonly scale: PlotScale = { kind: 'price' };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS, DEVIATIONS];

    /**
     * Bars needed before the window for the first channel to be a full one.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return readSetting(settings, PERIOD_BARS);
    }

    /**
     * Builds the middle line and the two edges of the channel.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns Three lines and the region between the outer two.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const deviations = readSetting(input.settings, DEVIATIONS);

        const middle = createBlankValues(bars.length);
        const upper = createBlankValues(bars.length);
        const lower = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            for (let index = segment.startIndex + periodBars - 1; index < segment.endIndex; index += 1) {
                const spread = this.measureWindow(bars, index, periodBars);
                middle[index] = spread.mean;
                upper[index] = spread.mean + deviations * spread.deviation;
                lower[index] = spread.mean - deviations * spread.deviation;
            }
        }

        const atMs = collectInstants(bars);
        return {
            indicatorId: this.id,
            labelKey: this.labelKey,
            parameterSummary: `${periodBars} · ${deviations}`,
            scale: this.scale,
            series: [
                { labelKey: 'indicator.bollinger.upper', tone: 'phosphor', shape: 'line', atMs, value: upper },
                { labelKey: 'indicator.bollinger.lower', tone: 'phosphor', shape: 'line', atMs, value: lower },
                { labelKey: 'indicator.bollinger.middle', tone: 'muted', shape: 'line', atMs, value: middle, isDashed: true },
            ],
            bands: [{ tone: 'phosphor', upperSeriesIndex: 0, lowerSeriesIndex: 1 }],
            hasConverged: input.warmupBarCount >= periodBars,
        };
    }

    /**
     * Mean and population deviation of the closes ending at an index.
     *
     * Population rather than sample: the window is the whole of what is being
     * described, not a draw from something larger.
     */
    private measureWindow(
        bars: IndicatorInput['bars']['bars'],
        endIndex: number,
        periodBars: number,
    ): { mean: number; deviation: number } {
        let total = 0;
        for (let index = endIndex - periodBars + 1; index <= endIndex; index += 1) {
            total += bars[index]!.closePrice;
        }
        const mean = total / periodBars;

        let squared = 0;
        for (let index = endIndex - periodBars + 1; index <= endIndex; index += 1) {
            const offset = bars[index]!.closePrice - mean;
            squared += offset * offset;
        }

        return { mean, deviation: Math.sqrt(squared / periodBars) };
    }
}

export const BOLLINGER_BANDS = new BollingerBands();
