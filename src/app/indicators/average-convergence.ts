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

const FAST_BARS: IndicatorParameter = {
    name: 'fastBars',
    kind: 'integer',
    defaultValue: 12,
    minimum: 2,
    maximum: 200,
};

const SLOW_BARS: IndicatorParameter = {
    name: 'slowBars',
    kind: 'integer',
    defaultValue: 26,
    minimum: 3,
    maximum: 400,
};

const SIGNAL_BARS: IndicatorParameter = {
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
    readonly id = 'macd';
    readonly labelKey = 'indicator.macd';
    readonly scale: PlotScale = { kind: 'symmetric' };
    readonly parameters: readonly IndicatorParameter[] = [FAST_BARS, SLOW_BARS, SIGNAL_BARS];

    /**
     * Bars needed before the window for both averages and the signal to settle.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        const slowBars = readSetting(settings, SLOW_BARS);
        const signalBars = readSetting(settings, SIGNAL_BARS);
        return Math.ceil((slowBars + signalBars) * 2.3);
    }

    /**
     * Builds the difference line, its own average, and the gap between them.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns Two lines and a histogram that changes colour at nought.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const fastBars = readSetting(input.settings, FAST_BARS);
        const slowBars = readSetting(input.settings, SLOW_BARS);
        const signalBars = readSetting(input.settings, SIGNAL_BARS);

        const difference = createBlankValues(bars.length);
        const signal = createBlankValues(bars.length);
        const gap = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            let fast = Number.NaN;
            let slow = Number.NaN;
            let smoothed = Number.NaN;
            const fastWeight = resolveExponentialWeight(fastBars);
            const slowWeight = resolveExponentialWeight(slowBars);
            const signalWeight = resolveExponentialWeight(signalBars);

            for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
                const closePrice = bars[index]!.closePrice;
                fast = Number.isNaN(fast) ? closePrice : fast + fastWeight * (closePrice - fast);
                slow = Number.isNaN(slow) ? closePrice : slow + slowWeight * (closePrice - slow);

                const separation = fast - slow;
                smoothed = Number.isNaN(smoothed)
                    ? separation
                    : smoothed + signalWeight * (separation - smoothed);

                difference[index] = separation;
                signal[index] = smoothed;
                gap[index] = separation - smoothed;
            }
        }

        const atMs = collectInstants(bars);
        return {
            indicatorId: this.id,
            labelKey: this.labelKey,
            parameterSummary: `${fastBars} · ${slowBars} · ${signalBars}`,
            scale: this.scale,
            series: [
                {
                    labelKey: 'indicator.macd.gap',
                    tone: 'bid',
                    negativeTone: 'ask',
                    shape: 'histogram',
                    baseline: 0,
                    atMs,
                    value: gap,
                },
                { labelKey: 'indicator.macd.difference', tone: 'phosphor', shape: 'line', atMs, value: difference },
                { labelKey: 'indicator.macd.signal', tone: 'amber', shape: 'line', atMs, value: signal },
            ],
            levels: [{ value: 0, tone: 'muted' }],
            hasConverged: input.warmupBarCount >= this.resolveWarmupBars(input.settings),
        };
    }
}

export const AVERAGE_CONVERGENCE = new AverageConvergence();
