import {
    type DrawPlan,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type IndicatorSettings,
    type NumericParameter,
    type PlotScale,
    readSetting,
} from '../../../shared/core/draw-plan.ts';
import {
    type BarSegment,
    collectInstants,
    createBlankValues,
    findContinuousSegments,
} from '../shared/series-math.ts';
import type { PriceBar } from '../../../shared/core/price-bar.ts';

const PERIOD_BARS: NumericParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 14,
    minimum: 2,
    maximum: 200,
};

/** Where the reading is conventionally read as stretched. */
const DRAINED = 20;
const FLOODED = 80;

/**
 * The same shape as the RSI, weighted by how much actually traded.
 *
 * A rise on almost no size and a rise on the day's heaviest bar move the RSI
 * identically; here the second counts for far more. What it is good for is
 * disagreement — price making a new high while this does not means the high was
 * made by fewer and fewer contracts.
 */
export class MoneyFlow implements Indicator {
    readonly id = 'mfi';
    readonly labelKey = 'indicator.mfi';
    readonly scale: PlotScale = { kind: 'fixed', low: 0, high: 100 };
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS];

    /**
     * Bars needed before the window for the first drawn value to be true.
     *
     * @param settings - The reader's parameter values.
     * @returns One period plus the bar its first comparison needs.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return readSetting(settings, PERIOD_BARS) + 1;
    }

    /**
     * Sorts each bar's traded value by which way the bar went, then compares the piles.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns One bounded line, with the two conventional thresholds marked.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const value = createBlankValues(bars.length);

        for (const segment of findContinuousSegments(bars)) {
            fillMoneyFlow({ bars, segment, periodBars, out: value });
        }

        return {
            indicatorId: this.id,
            labelKey: this.labelKey,
            parameterSummary: String(periodBars),
            scale: this.scale,
            series: [{
                labelKey: this.labelKey,
                tone: 'cyan',
                shape: 'line',
                atMs: collectInstants(bars),
                value,
            }],
            levels: [
                { value: FLOODED, tone: 'muted', isDashed: true },
                { value: DRAINED, tone: 'muted', isDashed: true },
            ],
            hasConverged: input.warmupBarCount >= this.resolveWarmupBars(input.settings),
        };
    }
}

interface MoneyFlowFill {
    readonly bars: readonly PriceBar[];
    readonly segment: BarSegment;
    readonly periodBars: number;
    readonly out: Float64Array;
}

/**
 * Sums the traded value either side of each bar's move, over a sliding window.
 */
function fillMoneyFlow(fill: MoneyFlowFill): void {
    const { bars, segment, periodBars, out } = fill;
    const { startIndex, endIndex } = segment;
    if (endIndex - startIndex <= periodBars) {
        return;
    }

    const flows = createBlankValues(bars.length);
    const isUp = new Uint8Array(bars.length);
    for (let index = startIndex + 1; index < endIndex; index += 1) {
        const typical = readTypicalPrice(bars[index]!);
        const previous = readTypicalPrice(bars[index - 1]!);
        const bar = bars[index]!;
        flows[index] = typical * (bar.buyVolume + bar.sellVolume);
        isUp[index] = typical > previous ? 1 : 0;
    }

    for (let index = startIndex + periodBars; index < endIndex; index += 1) {
        let flooding = 0;
        let draining = 0;
        for (let back = index - periodBars + 1; back <= index; back += 1) {
            const flow = flows[back]!;
            if (Number.isNaN(flow)) {
                continue;
            }
            if (isUp[back] === 1) {
                flooding += flow;
                continue;
            }
            draining += flow;
        }
        out[index] = toReading(flooding, draining);
    }
}

/**
 * The one price a whole bar is treated as having traded at.
 */
function readTypicalPrice(bar: PriceBar): number {
    return (bar.highPrice + bar.lowPrice + bar.closePrice) / 3;
}

/**
 * Two piles of traded value as a nought-to-hundred reading.
 *
 * A window with nothing on the draining side has no ratio to take, and reads as
 * the top of the scale rather than as nothing.
 */
function toReading(flooding: number, draining: number): number {
    if (draining === 0) {
        return flooding === 0 ? 50 : 100;
    }
    return 100 - 100 / (1 + flooding / draining);
}

export const MONEY_FLOW = new MoneyFlow();
