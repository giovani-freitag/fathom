import {
    type DrawPlan,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type NumericParameter,
    type IndicatorSettings,
    type PlotScale,
    readSetting,
} from '../../shared/core/draw-plan.ts';
import { collectInstants, createBlankValues, findContinuousSegments } from './series-math.ts';

const PERIOD_BARS: NumericParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 20,
    minimum: 2,
    maximum: 400,
};

/**
 * The highest and lowest the price has been over a fixed number of bars.
 */
export class DonchianChannels implements Indicator {
    readonly id = 'donchian';
    readonly labelKey = 'indicator.donchian';
    readonly scale: PlotScale = { kind: 'price' };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS];

    /**
     * Bars needed before the window for the first channel to span a full period.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return readSetting(settings, PERIOD_BARS);
    }

    /**
     * Traces the extremes of the window and the midpoint between them.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns Two edges, a midline, and the region between the edges.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);

        const upper = createBlankValues(bars.length);
        const lower = createBlankValues(bars.length);
        const middle = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            for (let index = segment.startIndex + periodBars - 1; index < segment.endIndex; index += 1) {
                let highest = Number.NEGATIVE_INFINITY;
                let lowest = Number.POSITIVE_INFINITY;
                for (let back = index - periodBars + 1; back <= index; back += 1) {
                    highest = Math.max(highest, bars[back]!.highPrice);
                    lowest = Math.min(lowest, bars[back]!.lowPrice);
                }
                upper[index] = highest;
                lower[index] = lowest;
                middle[index] = (highest + lowest) / 2;
            }
        }

        const atMs = collectInstants(bars);
        return {
            indicatorId: this.id,
            labelKey: this.labelKey,
            parameterSummary: String(periodBars),
            scale: this.scale,
            series: [
                { labelKey: 'indicator.donchian.upper', tone: 'ask', shape: 'line', atMs, value: upper },
                { labelKey: 'indicator.donchian.lower', tone: 'bid', shape: 'line', atMs, value: lower },
                { labelKey: 'indicator.donchian.middle', tone: 'muted', shape: 'line', atMs, value: middle, isDashed: true },
            ],
            bands: [{ tone: 'muted', upperSeriesIndex: 0, lowerSeriesIndex: 1 }],
            hasConverged: input.warmupBarCount >= periodBars,
        };
    }
}

export const DONCHIAN_CHANNELS = new DonchianChannels();
