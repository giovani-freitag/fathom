import { describe, expect, it } from 'vitest';
import { ExponentialAverage, resolveWarmupBars } from '../../../../src/app/indicators/exponential-average.ts';
import type { PriceBar, PriceBarWindow } from '../../../../src/shared/core/price-bar.ts';

const INTERVAL_MS = 60_000;

function buildBar(openedAtMs: number, closePrice: number): PriceBar {
    return {
        openedAtMs,
        closedAtMs: openedAtMs + INTERVAL_MS,
        openPrice: closePrice, highPrice: closePrice, lowPrice: closePrice, closePrice,
        expectedFrames: 60, frameCount: 60, isClosed: true,
        firstFrameAtMs: openedAtMs, lastFrameAtMs: openedAtMs + 59_000,
    };
}

function buildWindow(bars: PriceBar[], warmupBarsReturned = 0): PriceBarWindow {
    return {
        instrumentSymbol: 'BTCUSDT',
        intervalMs: INTERVAL_MS,
        warmupBarsRequested: warmupBarsReturned,
        warmupBarsReturned,
        bars,
    };
}

/** A run of bars a fixed step apart, so the average has something to converge on. */
function buildRun(count: number, price: (index: number) => number): PriceBar[] {
    return Array.from({ length: count }, (_, index) => buildBar(index * INTERVAL_MS, price(index)));
}

describe('resolveWarmupBars', () => {
    it('asks for more than the period, because the seed still weighs at the period', () => {
        // At 2/(n+1) smoothing the seed carries 13.5% of the weight after n
        // bars; a series that stops there looks settled and is not.
        expect(resolveWarmupBars(20)).toBeGreaterThan(20);
    });
});

describe('ExponentialAverage', () => {
    it('settles on a price that stops moving', () => {
        const average = new ExponentialAverage({ periodBars: 5 });

        const plan = average.compute({ bars: buildWindow(buildRun(60, () => 100)), warmupBarCount: 60 });

        expect(plan.series[0]?.value.at(-1)).toBeCloseTo(100, 6);
    });

    it('lags a rising price rather than tracking it', () => {
        const average = new ExponentialAverage({ periodBars: 20 });
        const bars = buildRun(60, (index) => 100 + index);

        const plan = average.compute({ bars: buildWindow(bars), warmupBarCount: 60 });

        const last = plan.series[0]!.value.at(-1)!;
        expect(last).toBeLessThan(bars.at(-1)!.closePrice);
        expect(last).toBeGreaterThan(bars.at(-30)!.closePrice);
    });

    it('restarts across a hole instead of smoothing over time nobody saw', () => {
        // Carrying an average across unrecorded time invents a trend through it.
        const average = new ExponentialAverage({ periodBars: 5 });
        const before = buildRun(10, () => 100);
        const after = [buildBar(30 * INTERVAL_MS, 200), buildBar(31 * INTERVAL_MS, 200)];

        const plan = average.compute({ bars: buildWindow([...before, ...after]), warmupBarCount: 10 });

        expect(plan.series[0]?.value[10]).toBe(200);
    });

    it('says it has not converged when the archive could not seed it', () => {
        const average = new ExponentialAverage({ periodBars: 20 });

        const plan = average.compute({ bars: buildWindow(buildRun(30, () => 100), 3), warmupBarCount: 3 });

        expect(plan.hasConverged).toBe(false);
    });

    it('says it has converged once the warm-up it asked for was supplied', () => {
        const average = new ExponentialAverage({ periodBars: 20 });
        const warmup = resolveWarmupBars(20);

        const plan = average.compute({
            bars: buildWindow(buildRun(warmup + 10, () => 100), warmup),
            warmupBarCount: warmup,
        });

        expect(plan.hasConverged).toBe(true);
    });

    it('plots one line and nothing else', () => {
        const plan = new ExponentialAverage({ periodBars: 20 })
            .compute({ bars: buildWindow(buildRun(30, () => 100)), warmupBarCount: 30 });

        expect(plan.series).toHaveLength(1);
        expect(plan.series[0]).toMatchObject({ shape: 'line', tone: 'phosphor' });
    });
});
