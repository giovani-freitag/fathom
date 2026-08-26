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
import { collectSource, SOURCE } from './bar-source.ts';
import {
    collectInstants,
    createBlankValues,
    findContinuousSegments,
    smoothWilder,
} from './series-math.ts';

const PERIOD_BARS: NumericParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 14,
    minimum: 2,
    maximum: 200,
};

/** Where the reading is conventionally read as stretched. */
const OVERSOLD = 30;
const OVERBOUGHT = 70;

/**
 * How much of recent movement has been upward, on a nought-to-hundred scale.
 */
export class RelativeStrength implements Indicator {
    readonly id = 'rsi';
    readonly labelKey = 'indicator.rsi';
    readonly scale: PlotScale = { kind: 'fixed', low: 0, high: 100 };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS, SOURCE];

    /**
     * Bars needed before the window for the smoothed averages to have settled.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return readSetting(settings, PERIOD_BARS) * 3;
    }

    /**
     * Turns the balance of rises and falls into one bounded line.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns One line, with the two conventional thresholds marked.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const value = createBlankValues(bars.length);

        const source = collectSource(bars, input.settings);
        for (const segment of findContinuousSegments(bars)) {
            fillRelativeStrength(source, periodBars, segment.startIndex, segment.endIndex, value);
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
            levels: [
                { value: OVERBOUGHT, tone: 'muted', isDashed: true },
                { value: OVERSOLD, tone: 'muted', isDashed: true },
            ],
            hasConverged: input.warmupBarCount >= this.resolveWarmupBars(input.settings),
        };
    }

}

/**
 * Seeds from the first full period of moves, then smooths the rest onto it.
 */
function fillRelativeStrength(
    source: ArrayLike<number>,
    periodBars: number,
    startIndex: number,
    endIndex: number,
    value: Float64Array,
): void {
    if (endIndex - startIndex <= periodBars) {
        return;
    }

    let averageGain = 0;
    let averageLoss = 0;
    for (let index = startIndex + 1; index <= startIndex + periodBars; index += 1) {
        const move = source[index]! - source[index - 1]!;
        averageGain += Math.max(0, move) / periodBars;
        averageLoss += Math.max(0, -move) / periodBars;
    }
    value[startIndex + periodBars] = toReading(averageGain, averageLoss);

    for (let index = startIndex + periodBars + 1; index < endIndex; index += 1) {
        const move = source[index]! - source[index - 1]!;
        averageGain = smoothWilder(averageGain, Math.max(0, move), periodBars);
        averageLoss = smoothWilder(averageLoss, Math.max(0, -move), periodBars);
        value[index] = toReading(averageGain, averageLoss);
    }
}

/**
 * A gain-to-loss ratio as a nought-to-hundred reading.
 *
 * A stretch with no losses at all has no ratio to take, and reads as the top of
 * the scale rather than as nothing.
 */
function toReading(averageGain: number, averageLoss: number): number {
    if (averageLoss === 0) {
        return averageGain === 0 ? 50 : 100;
    }
    return 100 - 100 / (1 + averageGain / averageLoss);
}

export const RELATIVE_STRENGTH = new RelativeStrength();
