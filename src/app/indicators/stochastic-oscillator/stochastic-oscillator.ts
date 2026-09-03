import {
    type PlanDraft,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type NumericParameter,
    type IndicatorSettings,
    type PlotScale,
    readSetting,
} from '../../../shared/core/draw-plan.ts';
import { collectInstants, createBlankValues, findContinuousSegments } from '../shared/series-math.ts';

const PERIOD_BARS: NumericParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 14,
    minimum: 2,
    maximum: 200,
};

const SMOOTHING_BARS: NumericParameter = {
    name: 'smoothingBars',
    kind: 'integer',
    defaultValue: 3,
    minimum: 1,
    maximum: 50,
};

const OVERSOLD = 20;
const OVERBOUGHT = 80;

/**
 * Where the close sits inside the range the price has covered recently.
 */
export class StochasticOscillator implements Indicator {
    readonly label = 'indicator.stochastic';
    readonly about = 'indicator.stochastic.help';
    readonly scale: PlotScale = { kind: 'fixed', low: 0, high: 100 };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS, SMOOTHING_BARS];

    /**
     * Bars needed before the window for both the range and its average to be full.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return readSetting(settings, PERIOD_BARS) + readSetting(settings, SMOOTHING_BARS);
    }

    /**
     * Places each close within its recent range, then averages the result.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns Two lines, with the two conventional thresholds marked.
     */
    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const smoothingBars = readSetting(input.settings, SMOOTHING_BARS);

        const position = createBlankValues(bars.length);
        const smoothed = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            for (let index = segment.startIndex + periodBars - 1; index < segment.endIndex; index += 1) {
                let highest = Number.NEGATIVE_INFINITY;
                let lowest = Number.POSITIVE_INFINITY;
                for (let back = index - periodBars + 1; back <= index; back += 1) {
                    highest = Math.max(highest, bars[back]!.highPrice);
                    lowest = Math.min(lowest, bars[back]!.lowPrice);
                }
                // A range of nothing means the price never moved, which is the
                // middle of it rather than a division nobody can take.
                position[index] = highest === lowest
                    ? 50
                    : ((bars[index]!.closePrice - lowest) / (highest - lowest)) * 100;
            }

            const firstSmoothed = segment.startIndex + periodBars + smoothingBars - 2;
            for (let index = firstSmoothed; index < segment.endIndex; index += 1) {
                let total = 0;
                for (let back = index - smoothingBars + 1; back <= index; back += 1) {
                    total += position[back]!;
                }
                smoothed[index] = total / smoothingBars;
            }
        }

        const atMs = collectInstants(bars);
        return {
            series: [
                { label: 'indicator.stochastic.position', tone: 'phosphor', shape: 'line', atMs, value: position },
                { label: 'indicator.stochastic.smoothed', tone: 'amber', shape: 'line', atMs, value: smoothed },
            ],
            levels: [
                { value: OVERBOUGHT, tone: 'muted', isDashed: true },
                { value: OVERSOLD, tone: 'muted', isDashed: true },
            ],
        };
    }
}

export const STOCHASTIC_OSCILLATOR = new StochasticOscillator();
