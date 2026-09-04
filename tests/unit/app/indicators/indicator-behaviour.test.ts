import { describe, expect, it } from 'vitest';
import { AVERAGE_CONVERGENCE } from '../../../../src/app/indicators/average-convergence/average-convergence.ts';
import { AVERAGE_TRUE_RANGE } from '../../../../src/app/indicators/average-true-range/average-true-range.ts';
import { BOLLINGER_BANDS } from '../../../../src/app/indicators/bollinger-bands/bollinger-bands.ts';
import { DONCHIAN_CHANNELS } from '../../../../src/app/indicators/donchian-channels/donchian-channels.ts';
import { RELATIVE_STRENGTH } from '../../../../src/app/indicators/relative-strength/relative-strength.ts';
import { SIMPLE_AVERAGE } from '../../../../src/app/indicators/simple-average/simple-average.ts';
import { STOCHASTIC_OSCILLATOR } from '../../../../src/app/indicators/stochastic-oscillator/stochastic-oscillator.ts';
import { completePlan, recolourPlan } from '../../../../src/shared/core/draw-plan.ts';
import type { Indicator, IndicatorSettings } from '../../../../src/shared/core/draw-plan.ts';
import { buildBar, buildRun, buildWindow } from '../../../mocks/price-bars.ts';
import type { PriceBar } from '../../../../src/shared/core/price-bar.ts';

function lastOf(indicator: Indicator, bars: readonly PriceBar[], settings: IndicatorSettings, seriesIndex = 0): number {
    const plan = indicator.compute({ bars: buildWindow(bars), sessions: {}, settings });
    return plan.series[seriesIndex]!.value.at(-1)!;
}

describe('SimpleAverage', () => {
    it('is the plain mean of the closes in its window', () => {
        const bars = buildRun(10, (index) => index * 10);

        const last = lastOf(SIMPLE_AVERAGE, bars, { periodBars: 4 });

        expect(last).toBeCloseTo((60 + 70 + 80 + 90) / 4, 6);
    });
});

describe('BollingerBands', () => {
    it('opens the channel as price starts moving further', () => {
        const calm = buildRun(60, (index) => 100 + (index % 2));
        const wild = buildRun(60, (index) => 100 + (index % 2) * 40);
        const settings = { periodBars: 20, deviations: 2 };

        const calmWidth = lastOf(BOLLINGER_BANDS, calm, settings) - lastOf(BOLLINGER_BANDS, calm, settings, 1);
        const wildWidth = lastOf(BOLLINGER_BANDS, wild, settings) - lastOf(BOLLINGER_BANDS, wild, settings, 1);

        expect(wildWidth).toBeGreaterThan(calmWidth * 10);
    });

    it('centres the channel on the mean it was built from', () => {
        const bars = buildRun(60, (index) => 100 + Math.sin(index) * 5);
        const settings = { periodBars: 20, deviations: 2 };

        const middle = lastOf(BOLLINGER_BANDS, bars, settings, 2);

        const upper = lastOf(BOLLINGER_BANDS, bars, settings, 0);
        const lower = lastOf(BOLLINGER_BANDS, bars, settings, 1);
        expect(middle).toBeCloseTo((upper + lower) / 2, 6);
    });
});

describe('DonchianChannels', () => {
    it('rides the highest bar of its window and no further back', () => {
        // A spike ten bars ago is inside a twenty-bar window and outside a five.
        const bars = buildRun(30, (index) => (index === 19 ? 500 : 100));

        const wide = lastOf(DONCHIAN_CHANNELS, bars, { periodBars: 20 });
        const narrow = lastOf(DONCHIAN_CHANNELS, bars, { periodBars: 5 });

        expect(wide).toBe(501);
        expect(narrow).toBe(101);
    });
});

describe('RelativeStrength', () => {
    it('reads the top of the scale when nothing has fallen', () => {
        const bars = buildRun(60, (index) => 100 + index);

        const last = lastOf(RELATIVE_STRENGTH, bars, { periodBars: 14 });

        expect(last).toBe(100);
    });

    it('reads the bottom when nothing has risen', () => {
        const bars = buildRun(60, (index) => 200 - index);

        const last = lastOf(RELATIVE_STRENGTH, bars, { periodBars: 14 });

        expect(last).toBe(0);
    });
});

describe('StochasticOscillator', () => {
    it('reads the top when the close is the high of its window', () => {
        const bars = buildRun(60, (index) => 100 + index);

        const last = lastOf(STOCHASTIC_OSCILLATOR, bars, { periodBars: 14, smoothingBars: 1 });

        // The close sits one under the bar's own high, so the reading is the
        // top of the range rather than exactly a hundred.
        expect(last).toBeGreaterThan(90);
    });
});

describe('AverageConvergence', () => {
    it('puts the fast mean above the slow one while price is rising', () => {
        const bars = buildRun(200, (index) => 100 + index);

        const difference = lastOf(AVERAGE_CONVERGENCE, bars, { fastBars: 12, slowBars: 26, signalBars: 9 }, 1);

        expect(difference).toBeGreaterThan(0);
    });

    it('draws the histogram as the distance from the difference to its own average', () => {
        const bars = buildRun(200, (index) => 100 + Math.sin(index / 9) * 20);
        const settings = { fastBars: 12, slowBars: 26, signalBars: 9 };

        const gap = lastOf(AVERAGE_CONVERGENCE, bars, settings, 0);

        const difference = lastOf(AVERAGE_CONVERGENCE, bars, settings, 1);
        const signal = lastOf(AVERAGE_CONVERGENCE, bars, settings, 2);
        expect(gap).toBeCloseTo(difference - signal, 6);
    });
});

describe('AverageTrueRange', () => {
    it('reads higher for bars that cover more ground', () => {
        const tight = buildRun(60, () => 100);
        const wide = Array.from({ length: 60 }, (_, index) => buildBar(
            index * 60_000,
            100,
            { highPrice: 130, lowPrice: 70 },
        ));

        const tightRange = lastOf(AVERAGE_TRUE_RANGE, tight, { periodBars: 14 });
        const wideRange = lastOf(AVERAGE_TRUE_RANGE, wide, { periodBars: 14 });

        expect(wideRange).toBeGreaterThan(tightRange * 10);
    });
});

describe('recolourPlan', () => {
    it('moves the line a reader points at, not the shading under it', () => {
        // MACD draws its histogram first so it sits beneath the lines. Reading
        // the first series as the identity would put the legend's mark on the
        // histogram and leave the line it names in another colour entirely.
        const settings = { fastBars: 12, slowBars: 26, signalBars: 9 };
        const plan = completePlan({
            indicatorId: 'macd', indicator: AVERAGE_CONVERGENCE, settings, warmupBarCount: 500,
        }, AVERAGE_CONVERGENCE.compute({
            bars: buildWindow(buildRun(200, (index) => 100 + index)),
            sessions: {},
            settings,
        }));

        const recoloured = recolourPlan(plan, 'violet');

        const byLabel = new Map(recoloured.series.map((series) => [series.label, series.tone]));
        expect(byLabel.get('indicator.macd.difference')).toBe('violet');
        expect(byLabel.get('indicator.macd.gap')).toBe('bid');
        expect(byLabel.get('indicator.macd.signal')).toBe('amber');
    });

    it('carries a band along with the line it belongs to', () => {
        const bollingerSettings = { periodBars: 20, deviations: 2 };
        const plan = completePlan({
            indicatorId: 'bollinger', indicator: BOLLINGER_BANDS, settings: bollingerSettings, warmupBarCount: 500,
        }, BOLLINGER_BANDS.compute({
            bars: buildWindow(buildRun(60, (index) => 100 + Math.sin(index) * 5)),
            sessions: {},
            settings: bollingerSettings,
        }));

        const recoloured = recolourPlan(plan, 'cyan');

        expect(recoloured.bands?.[0]?.tone).toBe('cyan');
        expect(recoloured.series[2]?.tone).toBe('muted');
    });
});
