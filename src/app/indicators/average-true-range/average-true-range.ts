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
import {
    collectInstants,
    createBlankValues,
    fillWilder,
    findContinuousSegments,
    resolveTrueRange,
} from '../shared/series-math.ts';

const PERIOD_BARS: NumericParameter = {
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
    readonly label = 'indicator.atr';
    readonly about = 'indicator.atr.help';
    readonly scale: PlotScale = { kind: 'auto' };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS];

    /**
     * Bars needed before the window for the smoothed range to have settled.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count, as the only source it declares.
     */
    resolveSources(settings: IndicatorSettings): SourceRequest {
        return { warmupBars: readSetting(settings, PERIOD_BARS) * 3 };
    }

    /**
     * Smooths the per-bar travel into one line.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns One line on a scale of its own.
     */
    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const value = createBlankValues(bars.length);

        const trueRanges = new Float64Array(bars.length);
        for (const segment of findContinuousSegments(bars)) {
            for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
                const bar = bars[index]!;
                // The first bar of a stretch has no close behind it, so its
                // range is its own extent rather than a reach to a bar that was
                // never recorded.
                trueRanges[index] = index === segment.startIndex
                    ? bar.highPrice - bar.lowPrice
                    : resolveTrueRange(bar, bars[index - 1]!.closePrice);
            }
            fillWilder({ source: trueRanges, periodBars, segment, out: value });
        }

        return {
            series: [{
                label: this.label,
                tone: 'amber',
                shape: 'line',
                atMs: collectInstants(bars),
                value,
            }],
        };
    }
}

export const AVERAGE_TRUE_RANGE = new AverageTrueRange();
