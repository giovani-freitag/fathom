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
import { collectSource, SOURCE } from '../../../shared/core/bar-source.ts';
import {
    collectInstants,
    createBlankValues,
    fillExponential,
    findContinuousSegments,
} from '../../../shared/core/series-math.ts';

const FAST_BARS: NumericParameter = {
    name: 'fastBars',
    kind: 'integer',
    defaultValue: 12,
    minimum: 2,
    maximum: 200,
};

const SLOW_BARS: NumericParameter = {
    name: 'slowBars',
    kind: 'integer',
    defaultValue: 26,
    minimum: 3,
    maximum: 400,
};

const SIGNAL_BARS: NumericParameter = {
    name: 'signalBars',
    kind: 'integer',
    defaultValue: 9,
    minimum: 2,
    maximum: 200,
};

/**
 * The distance between a fast and a slow average, and how fast that is changing.
 */
export class AverageConvergence implements Indicator {
    readonly label = 'indicator.macd';
    readonly about = 'indicator.macd.help';
    readonly scale: PlotScale = { kind: 'symmetric' };
    readonly parameters: readonly IndicatorParameter[] = [FAST_BARS, SLOW_BARS, SIGNAL_BARS, SOURCE];

    /**
     * Bars needed before the window for both averages and the signal to settle.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count, as the only source it declares.
     */
    resolveSources(settings: IndicatorSettings): SourceRequest {
        const slowBars = readSetting(settings, SLOW_BARS);
        const signalBars = readSetting(settings, SIGNAL_BARS);
        return { warmupBars: Math.ceil((slowBars + signalBars) * 2.3) };
    }

    /**
     * Builds the difference line, its own average, and the gap between them.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns Two lines and a histogram that changes colour at nought.
     */
    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const fastBars = readSetting(input.settings, FAST_BARS);
        const slowBars = readSetting(input.settings, SLOW_BARS);
        const signalBars = readSetting(input.settings, SIGNAL_BARS);

        const difference = createBlankValues(bars.length);
        const signal = createBlankValues(bars.length);
        const gap = createBlankValues(bars.length);

        const source = collectSource(bars, input.settings);
        const fast = createBlankValues(bars.length);
        const slow = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            fillExponential({ source, periodBars: fastBars, segment, out: fast });
            fillExponential({ source, periodBars: slowBars, segment, out: slow });

            for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
                difference[index] = fast[index]! - slow[index]!;
            }
            // Smoothed over the difference rather than over the price, and the
            // difference does not exist until the slower average does.
            fillExponential({ source: difference, periodBars: signalBars, segment, out: signal });

            for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
                gap[index] = difference[index]! - signal[index]!;
            }
        }

        const atMs = collectInstants(bars);
        return {
            series: [
                {
                    label: 'indicator.macd.gap',
                    tone: 'bid',
                    negativeTone: 'ask',
                    shape: 'histogram',
                    baseline: 0,
                    atMs,
                    value: gap,
                },
                { label: 'indicator.macd.difference', tone: 'phosphor', shape: 'line', atMs, value: difference },
                { label: 'indicator.macd.signal', tone: 'amber', shape: 'line', atMs, value: signal },
            ],
            levels: [{ value: 0, tone: 'muted' }],
        };
    }
}

export const AVERAGE_CONVERGENCE = new AverageConvergence();
