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

/** What the walk carries from one bar to the next. */
interface StopState {
    stop: number;
    extreme: number;
    speed: number;
    isRising: boolean;
}

/**
 * Carries the stop, the extreme it chases, and the speed across one stretch.
 *
 * The order of the four steps is the order the published listing puts them in
 * and is not interchangeable: the stop advances, then is tested for being
 * overtaken, then quickens, and only then is held out of the recent bars. Doing
 * the last of those first lets a clamped stop escape the very test it should
 * have failed.
 */
function walkStop(walk: StopWalk): void {
    const { bars, segment, step, rising, falling } = walk;
    const opensAt = segment.startIndex + 1;
    if (segment.endIndex - segment.startIndex < 2) {
        return;
    }

    const state = seedState(bars, opensAt, step);
    for (let index = opensAt; index < segment.endIndex; index += 1) {
        const bar = bars[index]!;
        state.stop += state.speed * (state.extreme - state.stop);

        turnIfOvertaken(state, bar, step);
        quickenIfExtended(state, bar, walk);
        state.stop = clampToRecentBars({ state, bars, index, opensAt });

        if (state.isRising) {
            rising[index] = state.stop;
            continue;
        }
        falling[index] = state.stop;
    }
}

/**
 * Opens the walk on the bar after the stretch begins.
 *
 * The direction comes from that bar against the one before it, the stop starts
 * on the far side of the earlier bar, and the extreme starts at the near side
 * of the later one.
 */
function seedState(bars: readonly PriceBar[], opensAt: number, step: number): StopState {
    const opening = bars[opensAt]!;
    const before = bars[opensAt - 1]!;
    const isRising = opening.closePrice > before.closePrice;
    return {
        stop: isRising ? before.lowPrice : before.highPrice,
        extreme: isRising ? opening.highPrice : opening.lowPrice,
        speed: step,
        isRising,
    };
}

/**
 * Sends the stop to the other side of price where this bar has passed it.
 *
 * It lands on the run's own extreme rather than where it had crept to, so the
 * new run starts as far from price as the old one ever reached.
 */
function turnIfOvertaken(state: StopState, bar: PriceBar, step: number): void {
    if (state.isRising && state.stop > bar.lowPrice) {
        state.isRising = false;
        state.stop = Math.max(bar.highPrice, state.extreme);
        state.extreme = bar.lowPrice;
        state.speed = step;
        return;
    }
    if (!state.isRising && state.stop < bar.highPrice) {
        state.isRising = true;
        state.stop = Math.min(bar.lowPrice, state.extreme);
        state.extreme = bar.highPrice;
        state.speed = step;
    }
}

/**
 * Speeds the stop up on a bar that pushed the run further than it had been.
 *
 * A bar that opened a run needs no guard of its own here. Opening one has
 * already set the extreme to that bar's own edge, so the bar cannot be further
 * out than the mark it just planted.
 */
function quickenIfExtended(state: StopState, bar: PriceBar, walk: StopWalk): void {
    const reached = state.isRising ? bar.highPrice : bar.lowPrice;
    const isFurther = state.isRising ? reached > state.extreme : reached < state.extreme;
    if (!isFurther) {
        return;
    }
    state.extreme = reached;
    state.speed = Math.min(state.speed + walk.step, walk.maximumStep);
}

interface StopClamp {
    readonly state: StopState;
    readonly bars: readonly PriceBar[];
    readonly index: number;
    readonly opensAt: number;
}

/**
 * Keeps the stop out of the range of the bars just before it.
 *
 * A stop inside the bar it is drawn on would be taken out by the very bar that
 * placed it, which is a signal the market never gave.
 */
function clampToRecentBars(clamp: StopClamp): number {
    const { state, bars, index, opensAt } = clamp;
    const previous = bars[index - 1]!;
    const before = index > opensAt ? bars[index - 2]! : previous;
    return state.isRising
        ? Math.min(state.stop, previous.lowPrice, before.lowPrice)
        : Math.max(state.stop, previous.highPrice, before.highPrice);
}

export const PARABOLIC_STOP = new ParabolicStop();
