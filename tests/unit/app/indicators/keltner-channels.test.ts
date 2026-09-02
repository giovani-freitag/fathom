import { describe, expect, it } from 'vitest';
import { NO_HIGHER_BARS } from '../../../../src/shared/core/draw-plan.ts';
import { KELTNER_CHANNELS } from '../../../../src/app/indicators/keltner-channels/keltner-channels.ts';
import { buildRun, buildWindow } from '../../../mocks/price-bars.ts';

const SETTINGS = { periodBars: 5, rangeBars: 5, multiplier: 2, source: 'close' };

/** A run of the given length, rising steadily. */
function computeOver(length: number, settings: Record<string, number | string> = SETTINGS) {
    return KELTNER_CHANNELS.compute({
        bars: buildWindow(buildRun(length, (index) => 100 + index)),
        warmupBarCount: 60,
        higher: NO_HIGHER_BARS,
        settings,
    });
}

/** The last value of a series that is not blank. */
function lastReal(values: Float64Array): number {
    for (let index = values.length - 1; index >= 0; index -= 1) {
        if (!Number.isNaN(values[index]!)) {
            return values[index]!;
        }
    }
    return Number.NaN;
}

describe('KeltnerChannels', () => {
    it('draws a middle with an edge either side of it', () => {
        const plan = computeOver(60);

        expect(plan.series).toHaveLength(3);
    });

    it('puts the edges around the middle, not through it', () => {
        const plan = computeOver(60);
        const [upper, middle, lower] = plan.series.map((series) => lastReal(series.value));

        expect([upper! > middle!, middle! > lower!]).toEqual([true, true]);
    });

    it('widens the band as the multiplier is turned up', () => {
        const width = (multiplier: number): number => {
            const plan = computeOver(60, { ...SETTINGS, multiplier });
            return lastReal(plan.series[0]!.value) - lastReal(plan.series[2]!.value);
        };

        expect(width(3)).toBeGreaterThan(width(1));
    });

    it('shades what lies between the edges, which is the reading', () => {
        const plan = computeOver(60);

        expect(plan.bands).toEqual([{ tone: 'ink', upperSeriesIndex: 0, lowerSeriesIndex: 2 }]);
    });

    it('says it has not converged on a window shorter than its smoothing', () => {
        const plan = KELTNER_CHANNELS.compute({
            bars: buildWindow(buildRun(60, (index) => 100 + index)),
            warmupBarCount: 0,
            higher: NO_HIGHER_BARS,
            settings: SETTINGS,
        });

        expect(plan.hasConverged).toBe(false);
    });

    it('measures the band by how far bars travelled, not by where they closed', () => {
        // The difference from Bollinger's, and the reason to have both: a run
        // of long wicks that all close together barely moves a standard
        // deviation and moves this a great deal.
        const steady = buildRun(60, () => 100).map((bar) => ({ ...bar, highPrice: 101, lowPrice: 99 }));
        const wild = buildRun(60, () => 100).map((bar) => ({ ...bar, highPrice: 120, lowPrice: 80 }));

        const widthOf = (bars: typeof steady): number => {
            const plan = KELTNER_CHANNELS.compute({
                bars: buildWindow(bars), warmupBarCount: 60, higher: NO_HIGHER_BARS, settings: SETTINGS,
            });
            return lastReal(plan.series[0]!.value) - lastReal(plan.series[2]!.value);
        };

        expect(widthOf(wild)).toBeGreaterThan(widthOf(steady));
    });
});
