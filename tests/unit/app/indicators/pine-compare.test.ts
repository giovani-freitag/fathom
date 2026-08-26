import { describe, expect, it } from 'vitest';
import { atr, ema, rsi, sma, stdevPop } from '../../../mocks/pine-oracle.ts';
import { AVERAGE_TRUE_RANGE } from '../../../../src/app/indicators/average-true-range.ts';
import { BOLLINGER_BANDS } from '../../../../src/app/indicators/bollinger-bands.ts';
import { EXPONENTIAL_AVERAGE } from '../../../../src/app/indicators/exponential-average.ts';
import type { Indicator, IndicatorSettings } from '../../../../src/shared/core/draw-plan.ts';
import { RELATIVE_STRENGTH } from '../../../../src/app/indicators/relative-strength.ts';
import { SIMPLE_AVERAGE } from '../../../../src/app/indicators/simple-average.ts';
import { buildBar, buildWindow } from '../../../mocks/price-bars.ts';

/** Wanders and trends at once, so nothing passes by being flat or monotone. */
const CLOSES = Array.from({ length: 120 }, (_, index) => 100 + Math.sin(index / 6) * 9 + index * 0.4);
const HIGHS = CLOSES.map((close) => close + 1.5);
const LOWS = CLOSES.map((close) => close - 1.5);

const BARS = buildWindow(CLOSES.map((close, index) => buildBar(index * 60_000, close, {
    highPrice: HIGHS[index]!,
    lowPrice: LOWS[index]!,
})));

/** Wide enough for accumulated rounding, far below anything a reader could see. */
const TOLERANCE = 1e-9;

function ours(indicator: Indicator, settings: IndicatorSettings, seriesIndex = 0): number[] {
    const plan = indicator.compute({ bars: BARS, warmupBarCount: 500, settings });
    return [...plan.series[seriesIndex]!.value];
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
});
