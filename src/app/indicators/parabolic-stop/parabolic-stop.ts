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

const STEP: NumericParameter = {
    name: 'step',
    kind: 'decimal',
    defaultValue: 0.02,
    minimum: 0.001,
    maximum: 0.2,
    step: 0.001,
};

const MAXIMUM_STEP: NumericParameter = {
    name: 'maximumStep',
    kind: 'decimal',
    defaultValue: 0.2,
    minimum: 0.01,
    maximum: 1,
    step: 0.01,
};

/**
 * A stop that starts far from price and closes in faster the longer a run lasts.
 *
 * The distance is not scaled by volatility but by *persistence*: every bar that
 * makes a new extreme in the direction of the run speeds the stop up, so a move
 * that keeps going gets a tighter and tighter leash while one that stalls keeps
 * the room it had. Where it crosses price the run is over and it appears on the
 * other side.
 */
export class ParabolicStop implements Indicator {
    readonly id = 'psar';
    readonly labelKey = 'indicator.psar';
    readonly scale: PlotScale = { kind: 'price' };
    readonly isSelfColoured = true;
    readonly parameters: readonly IndicatorParameter[] = [STEP, MAXIMUM_STEP];

    /**
     * Bars needed before the window for the stop to have forgotten where it started.
     *
     * @param settings - The reader's parameter values.
     * @returns How many bars it takes to reach the fastest step twice over.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        const step = readSetting(settings, STEP);
        const maximumStep = readSetting(settings, MAXIMUM_STEP);
        return Math.ceil(maximumStep / step) * 2;
    }

    /**
     * Walks the stop across the bars, flipping it where price overtakes it.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns Two sets of marks, one for each side the stop can be on.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const step = readSetting(input.settings, STEP);
        const maximumStep = readSetting(input.settings, MAXIMUM_STEP);

        const rising = createBlankValues(bars.length);
        const falling = createBlankValues(bars.length);
        for (const segment of findContinuousSegments(bars)) {
            walkStop({ bars, segment, step, maximumStep, rising, falling });
        }

        const atMs = collectInstants(bars);
        return {
            indicatorId: this.id,
            labelKey: this.labelKey,
            parameterSummary: `${String(step)}·${String(maximumStep)}`,
            scale: this.scale,
            isSelfColoured: this.isSelfColoured,
            series: [
                { labelKey: 'indicator.psar.rising', tone: 'bid', shape: 'dot', atMs, value: rising },
                { labelKey: 'indicator.psar.falling', tone: 'ask', shape: 'dot', atMs, value: falling },
            ],
            hasConverged: input.warmupBarCount >= this.resolveWarmupBars(input.settings),
        };
    }
}

interface StopWalk {
    readonly bars: readonly PriceBar[];
    readonly segment: BarSegment;
    readonly step: number;
    readonly maximumStep: number;
    readonly rising: Float64Array;
    readonly falling: Float64Array;
}

/**
 * Carries the stop, the extreme it chases, and the speed across one stretch.
 */
function walkStop(walk: StopWalk): void {
    const { bars, segment, step, maximumStep, rising, falling } = walk;
    const first = bars[segment.startIndex];
    if (first === undefined || segment.endIndex - segment.startIndex < 2) {
        return;
    }

    // Seeded from the first bar of the stretch rather than guessed: the stop
    // starts on the far side of it and the extreme starts at the near side, so
    // whichever way the second bar goes, the walk is already consistent.
    let isRising = bars[segment.startIndex + 1]!.closePrice >= first.closePrice;
    let stop = isRising ? first.lowPrice : first.highPrice;
    let extreme = isRising ? first.highPrice : first.lowPrice;
    let speed = step;

    for (let index = segment.startIndex + 1; index < segment.endIndex; index += 1) {
        const bar = bars[index]!;
        stop = clampToRecentBars({ offered: stop + speed * (extreme - stop), bars, index, isRising });

        if (isRising && bar.lowPrice < stop) {
            isRising = false;
            stop = extreme;
            extreme = bar.lowPrice;
            speed = step;
        } else if (!isRising && bar.highPrice > stop) {
            isRising = true;
            stop = extreme;
            extreme = bar.highPrice;
            speed = step;
        } else if (isRising && bar.highPrice > extreme) {
            extreme = bar.highPrice;
            speed = Math.min(speed + step, maximumStep);
        } else if (!isRising && bar.lowPrice < extreme) {
            extreme = bar.lowPrice;
            speed = Math.min(speed + step, maximumStep);
        }

        if (isRising) {
            rising[index] = stop;
            continue;
        }
        falling[index] = stop;
    }
}

interface StopClamp {
    readonly offered: number;
    readonly bars: readonly PriceBar[];
    readonly index: number;
    readonly isRising: boolean;
}

/**
 * Keeps the stop out of the last two bars' range.
 *
 * A stop inside the bar it is drawn on would be taken out by the very bar that
 * placed it, which is a signal the market never gave.
 */
function clampToRecentBars(clamp: StopClamp): number {
    const { offered, bars, index, isRising } = clamp;
    const previous = bars[index - 1]!;
    const before = bars[index - 2] ?? previous;
    return isRising
        ? Math.min(offered, previous.lowPrice, before.lowPrice)
        : Math.max(offered, previous.highPrice, before.highPrice);
}

export const PARABOLIC_STOP = new ParabolicStop();
