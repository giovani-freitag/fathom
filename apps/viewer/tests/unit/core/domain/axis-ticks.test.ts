import { describe, expect, it } from 'vitest';
import { chooseNicePriceStep, choosePriceTicks, chooseTimeTicks } from '@core/domain/axis-ticks';

const VIEWPORT = { fromMs: 0, toMs: 900_000, lowPrice: 78_000, highPrice: 79_000 };

describe('chooseNicePriceStep', () => {
    it('rounds a raw step up to the next allowed multiple', () => {
        expect(chooseNicePriceStep(37)).toBe(50);
    });

    it('keeps a step already on an allowed multiple', () => {
        expect(chooseNicePriceStep(25)).toBe(25);
    });

    it('scales across orders of magnitude', () => {
        expect(chooseNicePriceStep(0.037)).toBe(0.05);
    });

    it('survives a step of zero', () => {
        expect(Number.isFinite(chooseNicePriceStep(0))).toBe(true);
    });
});

describe('choosePriceTicks', () => {
    it('spaces ticks evenly on a round step', () => {
        const ticks = choosePriceTicks(VIEWPORT, 800);
        const gaps = ticks.slice(1).map((price, index) => price - ticks[index]!);

        expect(new Set(gaps.map((gap) => gap.toFixed(6))).size).toBe(1);
    });

    it('keeps every tick inside the viewport', () => {
        const ticks = choosePriceTicks(VIEWPORT, 800);

        expect(ticks.every((price) => price >= 78_000 && price <= 79_000)).toBe(true);
    });

    it('produces roughly one tick per target spacing', () => {
        const ticks = choosePriceTicks(VIEWPORT, 800);

        expect(ticks.length).toBeGreaterThanOrEqual(4);
    });

    it('returns nothing for a viewport with no price span', () => {
        expect(choosePriceTicks({ ...VIEWPORT, highPrice: 78_000 }, 800)).toEqual([]);
    });
});

describe('chooseTimeTicks', () => {
    it('lands ticks on whole minutes for a fifteen-minute window', () => {
        const ticks = chooseTimeTicks(VIEWPORT, 1_200);

        expect(ticks.every((at) => at % 60_000 === 0)).toBe(true);
    });

    it('widens the step as the window grows', () => {
        const narrow = chooseTimeTicks({ ...VIEWPORT, toMs: 60_000 }, 1_200);
        const wide = chooseTimeTicks({ ...VIEWPORT, toMs: 604_800_000 }, 1_200);

        expect(wide.length).toBeLessThan(narrow.length * 4);
    });

    it('keeps every tick inside the viewport', () => {
        const ticks = chooseTimeTicks(VIEWPORT, 1_200);

        expect(ticks.every((at) => at >= 0 && at <= 900_000)).toBe(true);
    });

    it('returns nothing for a viewport with no time span', () => {
        expect(chooseTimeTicks({ ...VIEWPORT, toMs: 0 }, 1_200)).toEqual([]);
    });

    it('never runs away on a degenerate viewport', () => {
        const ticks = chooseTimeTicks({ ...VIEWPORT, fromMs: 0, toMs: 1 }, 100_000);

        expect(ticks.length).toBeLessThanOrEqual(512);
    });
});
