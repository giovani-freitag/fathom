import { describe, expect, it } from 'vitest';
import { BAR_INTERVAL_MS, buildBar, buildRun, buildWindow } from '../../../mocks/price-bars.ts';
import { DIRECTIONAL_MOVEMENT } from '../../../../src/app/indicators/directional-movement/directional-movement.ts';
import type { PriceBar } from '../../../../src/shared/core/price-bar.ts';

const SETTINGS = { periodBars: 14 };

function computeOver(bars: readonly PriceBar[]) {
    return DIRECTIONAL_MOVEMENT.compute({ bars: buildWindow(bars), sessions: {}, settings: SETTINGS });
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

describe('DirectionalMovement', () => {
    const rise = buildRun(120, (index) => 100 + index);
    const fall = buildRun(120, (index) => 220 - index);
    const chop = buildRun(120, (index) => 100 + (index % 2));

    it('draws the strength and both sides', () => {
        expect(computeOver(rise).series).toHaveLength(3);
    });

    it('leans upward while price is rising', () => {
        const plan = computeOver(rise);

        expect(lastReal(plan.series[1]!.value)).toBeGreaterThan(lastReal(plan.series[2]!.value));
    });

    it('leans downward while price is falling', () => {
        const plan = computeOver(fall);

        expect(lastReal(plan.series[2]!.value)).toBeGreaterThan(lastReal(plan.series[1]!.value));
    });

    it('reads a hard trend as stronger than a market going nowhere', () => {
        const strengthOf = (bars: readonly PriceBar[]): number => lastReal(computeOver(bars).series[0]!.value);

        expect(strengthOf(rise)).toBeGreaterThan(strengthOf(chop));
    });

    it('reads a fall as strong as a rise, because strength has no side', () => {
        const strengthOf = (bars: readonly PriceBar[]): number => lastReal(computeOver(bars).series[0]!.value);

        expect(strengthOf(fall)).toBeCloseTo(strengthOf(rise), 6);
    });

    it('counts a bar that reached past the last one on both sides for one side only', () => {
        // An outside bar overhangs upward and downward at once. It is not two
        // directional moves; it is one, on whichever side reached further.
        const outsideBars = Array.from({ length: 120 }, (_, index) => buildBar(
            index * BAR_INTERVAL_MS,
            100 + index,
            { highPrice: 100 + index * 3, lowPrice: 100 - index * 2 },
        ));

        const plan = computeOver(outsideBars);

        expect(lastReal(plan.series[2]!.value)).toBe(0);
    });

    it('keeps every reading on the nought-to-hundred scale it declares', () => {
        const plan = computeOver(rise);
        const outside = plan.series
            .flatMap((series) => [...series.value])
            .filter((value) => !Number.isNaN(value) && (value < 0 || value > 100));

        expect(outside).toEqual([]);
    });

    it('marks the level a trend is conventionally read as tradable above', () => {
        expect(computeOver(rise).levels).toEqual([{ value: 25, tone: 'muted', isDashed: true }]);
    });

    it('starts over on the far side of a hole in the recording', () => {
        const held = buildRun(60, (index) => 100 + index);
        const resumed = buildRun(60, (index) => 200 + index).map((bar, index): PriceBar => ({
            ...bar,
            openedAtMs: (index + 120) * BAR_INTERVAL_MS,
            closedAtMs: (index + 121) * BAR_INTERVAL_MS,
        }));

        const plan = computeOver([...held, ...resumed]);

        expect(Number.isNaN(plan.series[1]!.value[60]!)).toBe(true);
    });
});
