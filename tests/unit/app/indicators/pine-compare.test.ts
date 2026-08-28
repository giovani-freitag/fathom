import { describe, expect, it } from 'vitest';
import { atr, cci, dmi, ema, mfi, rsi, sar, sma, stdevPop, supertrend } from '../../../mocks/pine-oracle.ts';
import { AVERAGE_TRUE_RANGE } from '../../../../src/app/indicators/average-true-range/average-true-range.ts';
import { BOLLINGER_BANDS } from '../../../../src/app/indicators/bollinger-bands/bollinger-bands.ts';
import { EXPONENTIAL_AVERAGE } from '../../../../src/app/indicators/exponential-average/exponential-average.ts';
import type { Indicator, IndicatorSettings } from '../../../../src/shared/core/draw-plan.ts';
import { COMMODITY_CHANNEL } from '../../../../src/app/indicators/commodity-channel/commodity-channel.ts';
import { DIRECTIONAL_MOVEMENT } from '../../../../src/app/indicators/directional-movement/directional-movement.ts';
import { MONEY_FLOW } from '../../../../src/app/indicators/money-flow/money-flow.ts';
import { PARABOLIC_STOP } from '../../../../src/app/indicators/parabolic-stop/parabolic-stop.ts';
import { RELATIVE_STRENGTH } from '../../../../src/app/indicators/relative-strength/relative-strength.ts';
import { SIMPLE_AVERAGE } from '../../../../src/app/indicators/simple-average/simple-average.ts';
import { SUPERTREND } from '../../../../src/app/indicators/supertrend/supertrend.ts';
import { buildBar, buildWindow } from '../../../mocks/price-bars.ts';

/** Wanders and trends at once, so nothing passes by being flat or monotone. */
const CLOSES = Array.from({ length: 120 }, (_, index) => 100 + Math.sin(index / 6) * 9 + index * 0.4);
const HIGHS = CLOSES.map((close) => close + 1.5);
const LOWS = CLOSES.map((close) => close - 1.5);

/** Varies bar to bar, so a reading weighted by size differs from one that is not. */
const VOLUMES = CLOSES.map((_, index) => 10 + (index % 7) * 3);
const TYPICAL = CLOSES.map((close, index) => (HIGHS[index]! + LOWS[index]! + close) / 3);

const BARS = buildWindow(CLOSES.map((close, index) => buildBar(index * 60_000, close, {
    highPrice: HIGHS[index]!,
    lowPrice: LOWS[index]!,
    buyVolume: VOLUMES[index]! / 2,
    sellVolume: VOLUMES[index]! / 2,
})));

/**
 * The one value a reading that switches sides has on each bar.
 *
 * It ships as two series that are blank wherever the other is drawn, and the
 * reference is one series, so they are compared where the reading actually is.
 */
function merged(indicator: Indicator, settings: IndicatorSettings): number[] {
    const plan = indicator.compute({ bars: BARS, warmupBarCount: 500, settings });
    const [first, second] = plan.series;
    return [...first!.value].map((value, index) => (Number.isNaN(value) ? second!.value[index]! : value));
}

/** Wide enough for accumulated rounding, far below anything a reader could see. */
const TOLERANCE = 1e-9;

function ours(indicator: Indicator, settings: IndicatorSettings, seriesIndex = 0): number[] {
    const plan = indicator.compute({ bars: BARS, warmupBarCount: 500, settings });
    return [...plan.series[seriesIndex]!.value];
}

/**
 * Reverses hard and often, and engulfs the bar before it every so often.
 *
 * A smooth path never asks a reading what it does when a run turns on the same
 * bar that extends it, so the branches that decide a turn go unread and agree
 * with the reference for want of being run.
 */
const WHIPSAW = Array.from({ length: 120 }, (_, index) => 100
    + Math.sin(index / 2.2) * 12
    + Math.sin(index / 1.3) * 5);
const WHIPSAW_HIGHS = WHIPSAW.map((close, index) => close + (index % 5 === 0 ? 4.5 : 1.2));
const WHIPSAW_LOWS = WHIPSAW.map((close, index) => close - (index % 7 === 0 ? 4.5 : 1.2));
const WHIPSAW_BARS = buildWindow(WHIPSAW.map((close, index) => buildBar(index * 60_000, close, {
    highPrice: WHIPSAW_HIGHS[index]!,
    lowPrice: WHIPSAW_LOWS[index]!,
})));

/** The one value a side-switching reading has on each bar of the jagged path. */
function mergedOnWhipsaw(indicator: Indicator, settings: IndicatorSettings): number[] {
    const plan = indicator.compute({ bars: WHIPSAW_BARS, warmupBarCount: 500, settings });
    const [first, second] = plan.series;
    return [...first!.value].map((value, index) => (Number.isNaN(value) ? second!.value[index]! : value));
}

/**
 * The largest gap between two series, over the bars both of them speak for.
 */
function widestGap(mine: readonly number[], reference: readonly number[]): number {
    let widest = 0;
    let compared = 0;
    for (let index = 0; index < mine.length; index += 1) {
        if (Number.isNaN(mine[index]!) || Number.isNaN(reference[index]!)) {
            continue;
        }
        compared += 1;
        widest = Math.max(widest, Math.abs(mine[index]! - reference[index]!));
    }
    // A pair that never overlaps would otherwise pass by comparing nothing.
    expect(compared).toBeGreaterThan(80);
    return widest;
}

describe('agreement with the reference formulas', () => {
    it('averages the closes the way everyone else averages them', () => {
        const reference = CLOSES.map((_, index) => (index >= 19 ? sma(CLOSES, 20, index) : Number.NaN));

        expect(widestGap(ours(SIMPLE_AVERAGE, { periodBars: 20 }), reference)).toBeLessThan(TOLERANCE);
    });

    it('weights the recent the way everyone else weights it, seed included', () => {
        // The seed is the part that differs between implementations, and it is
        // the part a reader comparing two screens sees first.
        expect(widestGap(ours(EXPONENTIAL_AVERAGE, { periodBars: 20 }), ema(CLOSES, 20))).toBeLessThan(TOLERANCE);
    });

    it('reads relative strength on Wilder’s smoothing, not a plain mean', () => {
        expect(widestGap(ours(RELATIVE_STRENGTH, { periodBars: 14 }), rsi(CLOSES, 14))).toBeLessThan(TOLERANCE);
    });

    it('reads the middle where nothing moved either way', () => {
        // A book mid that sits still for a whole period is ordinary on a quiet
        // contract. There is no ratio to take, and the answer is not maximum
        // strength — a market that did not move is not a market rising hard.
        const still = Array.from({ length: CLOSES.length }, () => 100);
        const bars = buildWindow(still.map((close, index) => buildBar(index * 60_000, close)));

        const plan = RELATIVE_STRENGTH.compute({ bars, warmupBarCount: 500, settings: { periodBars: 14 } });

        expect(plan.series[0]!.value.at(-1)).toBe(50);
        expect(widestGap([...plan.series[0]!.value], rsi(still, 14))).toBeLessThan(TOLERANCE);
    });

    it('measures the channel on the population deviation, not the sample one', () => {
        const reference = CLOSES.map((_, index) => (
            index >= 19 ? sma(CLOSES, 20, index) + 2 * stdevPop(CLOSES, 20, index) : Number.NaN
        ));

        const upper = ours(BOLLINGER_BANDS, { periodBars: 20, deviations: 2 }, 0);
        expect(widestGap(upper, reference)).toBeLessThan(TOLERANCE);
    });

    it('smooths the true range on Wilder’s seed as well as his step', () => {
        const reference = atr(HIGHS, LOWS, CLOSES, 14);

        expect(widestGap(ours(AVERAGE_TRUE_RANGE, { periodBars: 14 }), reference)).toBeLessThan(TOLERANCE);
    });

    it('walks the Supertrend stop the way the published listing walks it', () => {
        const reference = supertrend(HIGHS, LOWS, CLOSES, 3, 10);

        expect(widestGap(merged(SUPERTREND, { periodBars: 10, multiplier: 3 }), reference)).toBeLessThan(TOLERANCE);
    });

    it('accelerates the parabolic stop the way the published listing accelerates it', () => {
        const reference = sar(HIGHS, LOWS, CLOSES, 0.02, 0.02, 0.2);

        expect(widestGap(merged(PARABOLIC_STOP, { step: 0.02, maximumStep: 0.2 }), reference)).toBeLessThan(TOLERANCE);
    });

    it('reads the two directional lines on Wilder’s smoothing', () => {
        const reference = dmi(HIGHS, LOWS, CLOSES, 14);
        const settings = { periodBars: 14 };

        expect(widestGap(ours(DIRECTIONAL_MOVEMENT, settings, 1), reference.plus)).toBeLessThan(TOLERANCE);
        expect(widestGap(ours(DIRECTIONAL_MOVEMENT, settings, 2), reference.minus)).toBeLessThan(TOLERANCE);
    });

    it('smooths the trend strength a second time, on the same seed', () => {
        const reference = dmi(HIGHS, LOWS, CLOSES, 14);

        expect(widestGap(ours(DIRECTIONAL_MOVEMENT, { periodBars: 14 }), reference.adx)).toBeLessThan(TOLERANCE);
    });

    it('weights the money flow by what traded, and on the same source', () => {
        const reference = mfi(TYPICAL, VOLUMES, 14);

        expect(widestGap(ours(MONEY_FLOW, { periodBars: 14 }), reference)).toBeLessThan(TOLERANCE);
    });

    it('divides the channel by the mean deviation, not the standard one', () => {
        const reference = cci(TYPICAL, 20);

        expect(widestGap(ours(COMMODITY_CHANNEL, { periodBars: 20 }), reference)).toBeLessThan(TOLERANCE);
    });

    it('turns the Supertrend where the listing turns it, on a path that whipsaws', () => {
        const reference = supertrend(WHIPSAW_HIGHS, WHIPSAW_LOWS, WHIPSAW, 3, 10);
        const mine = mergedOnWhipsaw(SUPERTREND, { periodBars: 10, multiplier: 3 });

        expect(widestGap(mine, reference)).toBeLessThan(TOLERANCE);
    });

    it('turns the parabolic stop where the listing turns it, on the same path', () => {
        const reference = sar(WHIPSAW_HIGHS, WHIPSAW_LOWS, WHIPSAW, 0.02, 0.02, 0.2);
        const mine = mergedOnWhipsaw(PARABOLIC_STOP, { step: 0.02, maximumStep: 0.2 });

        expect(widestGap(mine, reference)).toBeLessThan(TOLERANCE);
    });
});
