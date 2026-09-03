import {
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type IndicatorSettings,
    type NumericParameter,
    type PlanDraft,
    type PlotScale,
    readSetting,
    type SourceRequest,
} from '../../../shared/core/draw-plan.ts';
import { collectSource, SOURCE } from '../shared/bar-source.ts';
import { collectInstants, createBlankValues, findContinuousSegments } from '../shared/series-math.ts';

const PERIOD_BARS: NumericParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 20,
    minimum: 2,
    maximum: 400,
};

/**
 * The unweighted mean of the close over a fixed number of bars.
 */
export class SimpleAverage implements Indicator {
    readonly label = 'indicator.sma';
    readonly about = 'indicator.sma.help';
    readonly scale: PlotScale = { kind: 'price' };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS, SOURCE];

    /**
     * Bars needed before the window for the first drawn value to be a full mean.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count, as the only source it declares.
     */
    resolveSources(settings: IndicatorSettings): SourceRequest {
        return { warmupBars: readSetting(settings, PERIOD_BARS) };
    }

    /**
     * Averages the closes of a window into one line.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns One line, blank until the window behind it is full.
     */
    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const source = collectSource(bars, input.settings);
        const value = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            let runningTotal = 0;
            for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
                runningTotal += source[index]!;
                if (index - segment.startIndex >= periodBars) {
                    runningTotal -= source[index - periodBars]!;
                }
                if (index - segment.startIndex >= periodBars - 1) {
                    value[index] = runningTotal / periodBars;
                }
            }
        }

        return {
            series: [{
                label: this.label,
                tone: 'ink',
                shape: 'line',
                atMs: collectInstants(bars),
                value,
            }],
        };
    }
}

export const SIMPLE_AVERAGE = new SimpleAverage();
