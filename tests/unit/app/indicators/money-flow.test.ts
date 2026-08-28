import { describe, expect, it } from 'vitest';
import { BAR_INTERVAL_MS, buildBar, buildWindow } from '../../../mocks/price-bars.ts';
import { MONEY_FLOW } from '../../../../src/app/indicators/money-flow/money-flow.ts';
import type { PriceBar } from '../../../../src/shared/core/price-bar.ts';

const SETTINGS = { periodBars: 14 };

function computeOver(bars: readonly PriceBar[]) {
    return MONEY_FLOW.compute({ bars: buildWindow(bars), warmupBarCount: 60, settings: SETTINGS });
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

/** A zig-zag of thirty bars, with the given size traded on the bars that rose. */
function buildZigZag(volumeOnRises: number, volumeOnFalls: number): PriceBar[] {
    return Array.from({ length: 30 }, (_, index) => {
        const isRise = index % 2 === 0;
        const traded = isRise ? volumeOnRises : volumeOnFalls;
        return buildBar(index * BAR_INTERVAL_MS, isRise ? 102 : 100, {
            highPrice: isRise ? 103 : 101,
            lowPrice: isRise ? 101 : 99,
            buyVolume: traded / 2,
            sellVolume: traded / 2,
        });
    });
}

describe('MoneyFlow', () => {
    it('reads higher when the rises are the bars that carried the size', () => {
        expect(lastReading(buildZigZag(100, 10))).toBeGreaterThan(lastReading(buildZigZag(10, 100)));
    });

    it('reads the same price path differently when only the size differs', () => {
        expect(lastReading(buildZigZag(100, 10))).not.toBe(lastReading(buildZigZag(10, 10)));
    });

    it('keeps every reading on the nought-to-hundred scale it declares', () => {
        const value = computeOver(buildZigZag(100, 10)).series[0]!.value;
        const outside = [...value].filter((reading) => !Number.isNaN(reading) && (reading < 0 || reading > 100));

        expect(outside).toEqual([]);
    });

    it('sits in the middle over a stretch nobody traded', () => {
        expect(lastReading(buildZigZag(0, 0))).toBe(50);
    });

    it('reads the top of the scale when nothing at all was sold into a fall', () => {
        expect(lastReading(buildZigZag(100, 0))).toBe(100);
    });

    it('counts a bar that closed where the last one did on neither side', () => {
        // The published sums exclude an unchanged bar twice rather than sorting
        // it into the falls, and the quiet stretches are where the reading is
        // read for disagreement with price.
        const flat = Array.from({ length: 30 }, (_, index) => buildBar(index * BAR_INTERVAL_MS, 100, {
            highPrice: 101,
            lowPrice: 99,
            buyVolume: 50,
            sellVolume: 50,
        }));

        expect(lastReading(flat)).toBe(50);
    });

    it('marks both thresholds the reading is conventionally read against', () => {
        expect(computeOver(buildZigZag(10, 10)).levels).toEqual([
            { value: 80, tone: 'muted', isDashed: true },
            { value: 20, tone: 'muted', isDashed: true },
        ]);
    });

    it('draws nothing over a stretch shorter than the window it sums', () => {
        const plan = computeOver(buildZigZag(10, 10).slice(0, 10));
        const drawn = [...plan.series[0]!.value].filter((reading) => !Number.isNaN(reading));

        expect(drawn).toEqual([]);
    });

    it('starts over on the far side of a hole in the recording', () => {
        const held = buildZigZag(10, 10);
        const resumed = buildZigZag(10, 10).map((bar, index): PriceBar => ({
            ...bar,
            openedAtMs: (index + 60) * BAR_INTERVAL_MS,
            closedAtMs: (index + 61) * BAR_INTERVAL_MS,
        }));

        const plan = computeOver([...held, ...resumed]);

        expect(Number.isNaN(plan.series[0]!.value[30 + SETTINGS.periodBars - 1]!)).toBe(true);
    });
});
