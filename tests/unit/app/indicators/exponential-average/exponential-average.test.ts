import { describe, expect, it } from 'vitest';
import { completePlan, NO_HIGHER_BARS } from '../../../../../src/shared/core/draw-plan.ts';
import { EXPONENTIAL_AVERAGE, resolveWarmupBars } from '../../../../../src/app/indicators/exponential-average/exponential-average.ts';
import { BAR_INTERVAL_MS, buildBar, buildRun, buildWindow } from '../../../../mocks/price-bars.ts';

describe('resolveWarmupBars', () => {
    it('asks for more than the period, because the seed still weighs at the period', () => {
        // At 2/(n+1) smoothing the seed carries 13.5% of the weight after n
        // bars; a series that stops there looks settled and is not.
        expect(resolveWarmupBars(20)).toBeGreaterThan(20);
    });
});

describe('ExponentialAverage', () => {
    it('settles on a price that stops moving', () => {
        const settings = { periodBars: 5 };
        const plan = completePlan(
            { indicatorId: 'ema', indicator: EXPONENTIAL_AVERAGE, settings, warmupBarCount: 60 },
            EXPONENTIAL_AVERAGE.compute({
                bars: buildWindow(buildRun(60, () => 100)),
                warmupBarCount: 60,
                higher: NO_HIGHER_BARS,
                settings,
            }),
        );

        expect(plan.series[0]?.value.at(-1)).toBeCloseTo(100, 6);
    });

    it('lags a rising price rather than tracking it', () => {
        const bars = buildRun(60, (index) => 100 + index);

        const settings = { periodBars: 20 };
        const plan = completePlan(
            { indicatorId: 'ema', indicator: EXPONENTIAL_AVERAGE, settings, warmupBarCount: 60 },
            EXPONENTIAL_AVERAGE.compute({
                bars: buildWindow(bars),
                warmupBarCount: 60,
                higher: NO_HIGHER_BARS,
                settings,
            }),
        );

        const last = plan.series[0]!.value.at(-1)!;
        expect(last).toBeLessThan(bars.at(-1)!.closePrice);
        expect(last).toBeGreaterThan(bars.at(-30)!.closePrice);
    });

    it('restarts across a hole instead of smoothing over time nobody saw', () => {
        // Carrying an average across unrecorded time invents a trend through it.
        // Stated as independence rather than as a value: what is drawn after the
        // hole must be exactly what would be drawn if nothing preceded it.
        const before = buildRun(20, () => 100);
        const after = buildRun(20, (index) => 200 + index, 30);
        const settings = { periodBars: 5 };

        const across = EXPONENTIAL_AVERAGE.compute({
            bars: buildWindow([...before, ...after]),
            warmupBarCount: 20,
            higher: NO_HIGHER_BARS,
            settings,
        });

        const alone = EXPONENTIAL_AVERAGE.compute({
            bars: buildWindow(after),
            warmupBarCount: 0,
            higher: NO_HIGHER_BARS,
            settings,
        });
        expect([...across.series[0]!.value.slice(20)]).toEqual([...alone.series[0]!.value]);
    });

    it('says nothing after a hole until it has a full period to average', () => {
        // Seeding from two bars and drawing the result would show a settled-
        // looking line built out of almost nothing.
        const before = buildRun(20, () => 100);
        const after = [buildBar(30 * BAR_INTERVAL_MS, 200), buildBar(31 * BAR_INTERVAL_MS, 200)];

        const settings = { periodBars: 5 };
        const plan = completePlan(
            { indicatorId: 'ema', indicator: EXPONENTIAL_AVERAGE, settings, warmupBarCount: 20 },
            EXPONENTIAL_AVERAGE.compute({
                bars: buildWindow([...before, ...after]),
                warmupBarCount: 20,
                higher: NO_HIGHER_BARS,
                settings,
            }),
        );

        expect(plan.series[0]?.value[20]).toBeNaN();
        expect(plan.series[0]?.value[21]).toBeNaN();
    });

    it('says it has not converged when the archive could not seed it', () => {
        const settings = { periodBars: 20 };
        const plan = completePlan(
            { indicatorId: 'ema', indicator: EXPONENTIAL_AVERAGE, settings, warmupBarCount: 3 },
            EXPONENTIAL_AVERAGE.compute({
                bars: buildWindow(buildRun(30, () => 100), 3),
                warmupBarCount: 3,
                higher: NO_HIGHER_BARS,
                settings,
            }),
        );

        expect(plan.hasConverged).toBe(false);
    });

    it('says it has converged once the warm-up it asked for was supplied', () => {
        const warmup = resolveWarmupBars(20);

        const settings = { periodBars: 20 };
        const plan = completePlan(
            { indicatorId: 'ema', indicator: EXPONENTIAL_AVERAGE, settings, warmupBarCount: warmup },
            EXPONENTIAL_AVERAGE.compute({
                bars: buildWindow(buildRun(warmup + 10, () => 100), warmup),
                warmupBarCount: warmup,
                higher: NO_HIGHER_BARS,
                settings,
            }),
        );

        expect(plan.hasConverged).toBe(true);
    });

    it('plots one line and nothing else', () => {
        const settings = { periodBars: 20 };
        const plan = completePlan(
            { indicatorId: 'ema', indicator: EXPONENTIAL_AVERAGE, settings, warmupBarCount: 30 },
            EXPONENTIAL_AVERAGE.compute({
                bars: buildWindow(buildRun(30, () => 100)),
                warmupBarCount: 30,
                higher: NO_HIGHER_BARS,
                settings,
            }),
        );

        expect(plan.series).toHaveLength(1);
        expect(plan.series[0]).toMatchObject({ shape: 'line', tone: 'phosphor' });
    });
});
