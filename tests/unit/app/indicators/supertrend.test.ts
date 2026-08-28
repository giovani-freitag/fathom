import { describe, expect, it } from 'vitest';
import { buildBar, BAR_INTERVAL_MS, buildRun, buildWindow } from '../../../mocks/price-bars.ts';
import { SUPERTREND } from '../../../../src/app/indicators/supertrend/supertrend.ts';
import type { PriceBar } from '../../../../src/shared/core/price-bar.ts';

const SETTINGS = { periodBars: 5, multiplier: 3 };

function computeOver(bars: readonly PriceBar[], settings = SETTINGS) {
    return SUPERTREND.compute({ bars: buildWindow(bars), warmupBarCount: 60, settings });
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

/** How many of a series' values were drawn at all. */
function drawnCount(values: Float64Array): number {
    return values.reduce((count, value) => count + (Number.isNaN(value) ? 0 : 1), 0);
}

describe('Supertrend', () => {
    const rise = buildRun(60, (index) => 100 + index);

    it('draws one line for each side the stop can be on', () => {
        expect(computeOver(rise).series).toHaveLength(2);
    });

    it('keeps the stop under price while price is rising', () => {
        const plan = computeOver(rise);

        expect(lastReal(plan.series[0]!.value)).toBeLessThan(rise.at(-1)!.closePrice);
    });

    it('draws only one side at a time, so the two lines never cross', () => {
        const plan = computeOver(rise);
        const overlapping = [...plan.series[0]!.value]
            .filter((value, index) => !Number.isNaN(value) && !Number.isNaN(plan.series[1]!.value[index]!));

        expect(overlapping).toEqual([]);
    });

    it('leaves the stop further from price as the multiplier is turned up', () => {
        const gap = (multiplier: number): number => rise.at(-1)!.closePrice
            - lastReal(computeOver(rise, { ...SETTINGS, multiplier }).series[0]!.value);

        expect(gap(5)).toBeGreaterThan(gap(1));
    });

    it('moves the stop to the other side once price closes through it', () => {
        const reversal = [
            ...buildRun(40, (index) => 100 + index),
            ...buildRun(20, (index) => 139 - index * 6, 40),
        ];

        expect(drawnCount(computeOver(reversal).series[1]!.value)).toBeGreaterThan(0);
    });

    it('never loosens the stop while the side it is on holds', () => {
        const wobble = buildRun(60, (index) => 100 + index + (index % 2 === 0 ? 0.5 : 0));
        const drawn = [...computeOver(wobble).series[0]!.value].filter((value) => !Number.isNaN(value));
        const loosened = drawn.filter((value, index) => index > 0 && value < drawn[index - 1]!);

        expect(loosened).toEqual([]);
    });

    it('will not let the stop back up when a fall pauses to bounce', () => {
        // The ratchet is the whole reading. A stop that loosened whenever the
        // market breathed would sit further from price after every pullback and
        // would never be reached.
        const bounce = buildRun(60, (index) => (index < 30 ? 200 - index : Math.min(173, 168 + index - 30)));
        const drawn = [...computeOver(bounce).series[1]!.value].filter((value) => !Number.isNaN(value));
        const loosened = drawn.filter((value, index) => index > 0 && value > drawn[index - 1]!);

        expect(loosened).toEqual([]);
    });

    it('starts the stop over on the far side of a hole in the recording', () => {
        const held = buildRun(30, (index) => 100 + index);
        const resumed = buildRun(30, (index) => 200 + index).map((bar, index): PriceBar => ({
            ...bar,
            openedAtMs: (index + 90) * BAR_INTERVAL_MS,
            closedAtMs: (index + 91) * BAR_INTERVAL_MS,
        }));

        const plan = computeOver([...held, ...resumed]);

        expect(Number.isNaN(plan.series[0]!.value[30]!)).toBe(true);
    });

    it('colours itself, so the panel offers no colour to change', () => {
        expect(computeOver(rise).isSelfColoured).toBe(true);
    });

    it('says it has not converged on a window shorter than its smoothing', () => {
        const plan = SUPERTREND.compute({
            bars: buildWindow([buildBar(0, 100)]),
            warmupBarCount: 1,
            settings: SETTINGS,
        });

        expect(plan.hasConverged).toBe(false);
    });
});
