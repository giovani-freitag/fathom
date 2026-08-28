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
    collectTrueRanges,
    createBlankValues,
    fillWilder,
    findContinuousSegments,
} from '../shared/series-math.ts';
import type { PriceBar } from '../../../shared/core/price-bar.ts';

const PERIOD_BARS: NumericParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 10,
    minimum: 2,
    maximum: 200,
};

const MULTIPLIER: NumericParameter = {
    name: 'multiplier',
    kind: 'decimal',
    defaultValue: 3,
    minimum: 0.5,
    maximum: 10,
    step: 0.1,
};

/**
 * One line that sits under a rise and over a fall, and jumps when that changes.
 *
 * A stop rather than an average. It is placed a multiple of the recent range
 * away from the middle of the bar and then never allowed to loosen — it may
 * only tighten towards price — so the distance it keeps is the market's own
 * volatility rather than a fixed number of ticks. What a reader takes from it
 * is the side it is on, which is why it is drawn as two lines that never
 * overlap rather than as one that changes colour.
 */
export class Supertrend implements Indicator {
    readonly id = 'supertrend';
    readonly labelKey = 'indicator.supertrend';
    readonly scale: PlotScale = { kind: 'price' };
    readonly isSelfColoured = true;
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS, MULTIPLIER];

    /**
     * Bars needed before the window for the range it is scaled by to have settled.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return readSetting(settings, PERIOD_BARS) * 3;
    }

    /**
     * Walks the stop along the bars, flipping it whenever price closes past it.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns Two lines, one for each side the stop can be on.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);
        const multiplier = readSetting(input.settings, MULTIPLIER);

        const rising = createBlankValues(bars.length);
        const falling = createBlankValues(bars.length);
        for (const segment of findContinuousSegments(bars)) {
            walkStop({ bars, segment, periodBars, multiplier, rising, falling });
        }

        const atMs = collectInstants(bars);
        return {
            indicatorId: this.id,
            labelKey: this.labelKey,
            parameterSummary: `${String(periodBars)}·${String(multiplier)}`,
            scale: this.scale,
            isSelfColoured: this.isSelfColoured,
            series: [
                { labelKey: 'indicator.supertrend.rising', tone: 'bid', shape: 'line', atMs, value: rising, widthPx: 2 },
                { labelKey: 'indicator.supertrend.falling', tone: 'ask', shape: 'line', atMs, value: falling, widthPx: 2 },
            ],
            hasConverged: input.warmupBarCount >= this.resolveWarmupBars(input.settings),
        };
    }
}

interface StopWalk {
    readonly bars: readonly PriceBar[];
    readonly segment: BarSegment;
    readonly periodBars: number;
    readonly multiplier: number;
    readonly rising: Float64Array;
    readonly falling: Float64Array;
}

/**
 * Carries the stop and the side it is on across one unbroken stretch.
 */
function walkStop(walk: StopWalk): void {
    const { bars, segment, periodBars, multiplier, rising, falling } = walk;
    const range = createBlankValues(bars.length);
    fillWilder({ source: collectTrueRanges(bars, segment), periodBars, segment, out: range });

    let ceiling = Number.NaN;
    let floor = Number.NaN;
    let isRising = true;

    for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
        const bar = bars[index]!;
        const width = range[index]! * multiplier;
        if (Number.isNaN(width)) {
            continue;
        }

        const middle = (bar.highPrice + bar.lowPrice) / 2;
        const previousClose = bars[index - 1]?.closePrice ?? bar.closePrice;
        ceiling = holdCeiling(middle + width, ceiling, previousClose);
        floor = holdFloor(middle - width, floor, previousClose);

        isRising = resolveSide({ isRising, closePrice: bar.closePrice, ceiling, floor });
        if (isRising) {
            rising[index] = floor;
            continue;
        }
        falling[index] = ceiling;
    }
}

/**
 * The ceiling this bar leaves behind it.
 *
 * It may come down freely and may only go back up once price has closed above
 * it, which is what makes it a stop rather than a band: a level that loosened
 * whenever the market got wilder would never be reached.
 */
function holdCeiling(offered: number, held: number, previousClose: number): number {
    return Number.isNaN(held) || offered < held || previousClose > held ? offered : held;
}

/**
 * The floor this bar leaves behind it, by the same rule upside down.
 */
function holdFloor(offered: number, held: number, previousClose: number): number {
    return Number.isNaN(held) || offered > held || previousClose < held ? offered : held;
}

interface SideDecision {
    readonly isRising: boolean;
    readonly closePrice: number;
    readonly ceiling: number;
    readonly floor: number;
}

/**
 * Which side the stop is on once this bar has closed.
 */
function resolveSide(decision: SideDecision): boolean {
    if (decision.closePrice > decision.ceiling) {
        return true;
    }
    if (decision.closePrice < decision.floor) {
        return false;
    }
    return decision.isRising;
}

export const SUPERTREND = new Supertrend();
