import { describe, expect, it } from 'vitest';
import { BAR_INTERVAL_MS, buildBar, buildRun, buildWindow } from '../../../mocks/price-bars.ts';
import { PARABOLIC_STOP } from '../../../../src/app/indicators/parabolic-stop/parabolic-stop.ts';
import type { PriceBar } from '../../../../src/shared/core/price-bar.ts';

const SETTINGS = { step: 0.02, maximumStep: 0.2 };

function computeOver(bars: readonly PriceBar[], settings = SETTINGS) {
    return PARABOLIC_STOP.compute({ bars: buildWindow(bars), warmupBarCount: 60, settings });
}

/** How many of a series' values were drawn at all. */
function drawnCount(values: Float64Array): number {
    return values.reduce((count, value) => count + (Number.isNaN(value) ? 0 : 1), 0);
}

describe('ParabolicStop', () => {
    const rise = buildRun(60, (index) => 100 + index);

    it('draws its marks rather than joining them into a line', () => {
        expect(computeOver(rise).series.map((series) => series.shape)).toEqual(['dot', 'dot']);
    });

    it('keeps the marks under price while price is rising', () => {
        const value = computeOver(rise).series[0]!.value;
        const above = [...value].filter((stop, index) => !Number.isNaN(stop) && stop > rise[index]!.lowPrice);

        expect(above).toEqual([]);
    });

    it('draws only one side at a time', () => {
        const plan = computeOver(rise);
        const overlapping = [...plan.series[0]!.value]
            .filter((value, index) => !Number.isNaN(value) && !Number.isNaN(plan.series[1]!.value[index]!));

        expect(overlapping).toEqual([]);
    });

    it('closes in on price the longer the run lasts', () => {
        const value = computeOver(rise).series[0]!.value;
        const gapAt = (index: number): number => rise[index]!.lowPrice - value[index]!;

        expect(gapAt(50)).toBeLessThan(gapAt(10));
    });

    it('closes in faster as the step is turned up', () => {
        const gapAt = (step: number): number => {
            const value = computeOver(rise, { ...SETTINGS, step }).series[0]!.value;
            return rise[20]!.lowPrice - value[20]!;
        };

        expect(gapAt(0.05)).toBeLessThan(gapAt(0.01));
    });

    it('moves the marks to the other side once price overtakes them', () => {
        const reversal = [
            ...buildRun(40, (index) => 100 + index),
            ...buildRun(20, (index) => 139 - index * 6, 40),
        ];

        expect(drawnCount(computeOver(reversal).series[1]!.value)).toBeGreaterThan(0);
    });

    it('puts a turn clear of the bar that caused it, not at the run\u2019s old extreme', () => {
        // One bar can both extend a run and end it: a wide outside bar makes a
        // new high and takes the stop out on the same low. Landing at the old
        // extreme would leave the new stop inside the bar that just turned it.
        const engulfed = [
            ...buildRun(20, (index) => 100 + index),
            buildBar(20 * BAR_INTERVAL_MS, 96, { highPrice: 130, lowPrice: 95 }),
        ];

        const turned = computeOver(engulfed).series[1]!.value[20]!;

        expect(turned).toBeGreaterThanOrEqual(130);
    });

    it('keeps the stop out of the range of the bars just before it', () => {
        const value = computeOver(rise).series[0]!.value;
        const inside = [...value].filter((stop, index) => index >= 2
            && !Number.isNaN(stop)
            && stop > Math.min(rise[index - 1]!.lowPrice, rise[index - 2]!.lowPrice));

        expect(inside).toEqual([]);
    });

    it('starts the walk over on the far side of a hole in the recording', () => {
        const held = buildRun(30, (index) => 100 + index);
        const resumed = buildRun(30, (index) => 200 + index).map((bar, index): PriceBar => ({
            ...bar,
            openedAtMs: (index + 90) * BAR_INTERVAL_MS,
            closedAtMs: (index + 91) * BAR_INTERVAL_MS,
        }));

        const plan = computeOver([...held, ...resumed]);

        expect(Number.isNaN(plan.series[0]!.value[30]!)).toBe(true);
    });

    it('draws nothing for a stretch too short to have a direction', () => {
        const plan = computeOver(buildRun(1, () => 100));

        expect(drawnCount(plan.series[0]!.value) + drawnCount(plan.series[1]!.value)).toBe(0);
    });
});
