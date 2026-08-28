import { describe, expect, it } from 'vitest';
import { BAR_INTERVAL_MS, buildRun, buildWindow } from '../../../mocks/price-bars.ts';
import { COMMODITY_CHANNEL } from '../../../../src/app/indicators/commodity-channel/commodity-channel.ts';
import type { PriceBar } from '../../../../src/shared/core/price-bar.ts';

const SETTINGS = { periodBars: 20 };

function computeOver(bars: readonly PriceBar[]) {
    return COMMODITY_CHANNEL.compute({ bars: buildWindow(bars), warmupBarCount: 60, settings: SETTINGS });
}

/** The last value of the one series that is not blank. */
function lastReading(bars: readonly PriceBar[]): number {
    const value = computeOver(bars).series[0]!.value;
    for (let index = value.length - 1; index >= 0; index -= 1) {
        if (!Number.isNaN(value[index]!)) {
            return value[index]!;
        }
    }
    return Number.NaN;
}

describe('CommodityChannel', () => {
    it('reads above nought while price is above its own recent average', () => {
        expect(lastReading(buildRun(60, (index) => 100 + index))).toBeGreaterThan(0);
    });

    it('reads below nought while price is below it', () => {
        expect(lastReading(buildRun(60, (index) => 160 - index))).toBeLessThan(0);
    });

    it('reads nought over a stretch that never moved at all', () => {
        expect(lastReading(buildRun(60, () => 100))).toBe(0);
    });

    it('reads further out the further price has wandered', () => {
        const steep = lastReading(buildRun(60, (index) => 100 + index * index / 40));
        const gentle = lastReading(buildRun(60, (index) => 100 + index));

        expect(steep).toBeGreaterThan(gentle);
    });

    it('is not pinned to a ceiling the way a bounded oscillator is', () => {
        expect(lastReading(buildRun(60, (index) => 100 + index * index))).toBeGreaterThan(100);
    });

    it('reads the same on a path twice as wide, because the units are its own spread', () => {
        // What it measures is distance from the average divided by the usual
        // distance from the average. A market that moves twice as much in both
        // halves of that ratio has not moved any further in its own terms.
        const plain = lastReading(buildRun(60, (index) => 100 + index));
        const doubled = lastReading(buildRun(60, (index) => 2 * (100 + index)));

        expect(doubled).toBeCloseTo(plain, 6);
    });

    it('marks the two stretched thresholds and the middle', () => {
        expect(computeOver(buildRun(60, (index) => 100 + index)).levels).toEqual([
            { value: 100, tone: 'muted', isDashed: true },
            { value: 0, tone: 'muted', isDashed: true },
            { value: -100, tone: 'muted', isDashed: true },
        ]);
    });

    it('draws nothing over a stretch shorter than the window it averages', () => {
        const plan = computeOver(buildRun(10, (index) => 100 + index));
        const drawn = [...plan.series[0]!.value].filter((reading) => !Number.isNaN(reading));

        expect(drawn).toEqual([]);
    });

    it('starts over on the far side of a hole in the recording', () => {
        const held = buildRun(40, (index) => 100 + index);
        const resumed = buildRun(40, (index) => 200 + index).map((bar, index): PriceBar => ({
            ...bar,
            openedAtMs: (index + 80) * BAR_INTERVAL_MS,
            closedAtMs: (index + 81) * BAR_INTERVAL_MS,
        }));

        const plan = computeOver([...held, ...resumed]);

        expect(Number.isNaN(plan.series[0]!.value[40 + SETTINGS.periodBars - 2]!)).toBe(true);
    });
});
