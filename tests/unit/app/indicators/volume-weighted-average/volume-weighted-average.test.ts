import { describe, expect, it } from 'vitest';
import { buildBar, buildWindow } from '../../../../mocks/price-bars.ts';
import { VOLUME_WEIGHTED_AVERAGE } from '../../../../../src/app/indicators/volume-weighted-average/volume-weighted-average.ts';
import type { PriceBar } from '../../../../../src/shared/core/price-bar.ts';

const DAY_MS = 86_400_000;

function compute(bars: readonly PriceBar[], vwapAnchor = 'session') {
    return VOLUME_WEIGHTED_AVERAGE.compute({
        bars: buildWindow([...bars]),
        warmupBarCount: 0,
        settings: { vwapAnchor },
    });
}

function flat(openedAtMs: number, price: number, size: number): PriceBar {
    return buildBar(openedAtMs, price, {
        openPrice: price, highPrice: price, lowPrice: price, buyVolume: size, sellVolume: 0,
    });
}

describe('VolumeWeightedAverage', () => {
    it('leans toward the price the size traded at', () => {
        // The whole point of it: a mean of closes would answer 150 here, and
        // almost nothing changed hands at 200.
        const plan = compute([flat(DAY_MS, 100, 9), flat(DAY_MS + 60_000, 200, 1)]);

        expect(plan.series[0]?.value[1]).toBeCloseTo(110, 6);
    });

    it('starts over at the session, so today does not carry yesterday', () => {
        const plan = compute([
            flat(DAY_MS, 100, 10),
            flat(2 * DAY_MS, 200, 1),
        ]);

        expect(plan.series[0]?.value[1]).toBeCloseTo(200, 6);
    });

    it('carries the whole window across the session when anchored to it', () => {
        const plan = compute([
            flat(DAY_MS, 100, 9),
            flat(2 * DAY_MS, 200, 1),
        ], 'window');

        expect(plan.series[0]?.value[1]).toBeCloseTo(110, 6);
    });

    it('says nothing where nothing has traded yet', () => {
        // Carrying the last level forward would draw a price the market never
        // agreed on.
        const plan = compute([flat(DAY_MS, 100, 0), flat(DAY_MS + 60_000, 100, 5)]);

        expect(Number.isNaN(plan.series[0]?.value[0] ?? Number.NaN)).toBe(true);
        expect(plan.series[0]?.value[1]).toBeCloseTo(100, 6);
    });

    it('admits it has not reached the session it is anchored to', () => {
        // Every bar inside one day: the total starts where the window does,
        // which is not where the session did.
        const plan = compute([flat(DAY_MS + 60_000, 100, 5), flat(DAY_MS + 120_000, 100, 5)]);

        expect(plan.hasConverged).toBe(false);
    });

    it('is settled once the window holds the session boundary', () => {
        const plan = compute([flat(DAY_MS - 60_000, 100, 5), flat(DAY_MS, 100, 5)]);

        expect(plan.hasConverged).toBe(true);
    });
});
