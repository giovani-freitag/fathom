import { describe, expect, it } from 'vitest';
import { chooseNicePriceStep, choosePriceTicks, chooseTimeTicks } from '../../../../src/app/painting/axis-ticks.ts';

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
        const ticks = choosePriceTicks({ viewport: VIEWPORT, extentPx: 800, minimumSpacingPx: 64 });
        const gaps = ticks.slice(1).map((price, index) => price - ticks[index]!);

        expect(new Set(gaps.map((gap) => gap.toFixed(6))).size).toBe(1);
    });

    it('keeps every tick inside the viewport', () => {
        const ticks = choosePriceTicks({ viewport: VIEWPORT, extentPx: 800, minimumSpacingPx: 64 });

        expect(ticks.every((price) => price >= 78_000 && price <= 79_000)).toBe(true);
    });

    it('produces roughly one tick per target spacing', () => {
        const ticks = choosePriceTicks({ viewport: VIEWPORT, extentPx: 800, minimumSpacingPx: 64 });

        expect(ticks.length).toBeGreaterThanOrEqual(4);
    });

    it('returns nothing for a viewport with no price span', () => {
        expect(choosePriceTicks({ viewport: { ...VIEWPORT, highPrice: 78_000 }, extentPx: 800, minimumSpacingPx: 64 })).toEqual([]);
    });
});

describe('chooseTimeTicks', () => {
    it('lands ticks on whole minutes for a fifteen-minute window', () => {
        const ticks = chooseTimeTicks({ viewport: VIEWPORT, extentPx: 1_200, minimumSpacingPx: 96 });

        expect(ticks.every((at) => at % 60_000 === 0)).toBe(true);
    });

    it('widens the step as the window grows', () => {
        const narrow = chooseTimeTicks({ viewport: { ...VIEWPORT, toMs: 60_000 }, extentPx: 1_200, minimumSpacingPx: 96 });
        const wide = chooseTimeTicks({ viewport: { ...VIEWPORT, toMs: 604_800_000 }, extentPx: 1_200, minimumSpacingPx: 96 });

        expect(wide.length).toBeLessThan(narrow.length * 4);
    });

    it('keeps every tick inside the viewport', () => {
        const ticks = chooseTimeTicks({ viewport: VIEWPORT, extentPx: 1_200, minimumSpacingPx: 96 });

        expect(ticks.every((at) => at >= 0 && at <= 900_000)).toBe(true);
    });

    it('returns nothing for a viewport with no time span', () => {
        expect(chooseTimeTicks({ viewport: { ...VIEWPORT, toMs: 0 }, extentPx: 1_200, minimumSpacingPx: 96 })).toEqual([]);
    });

    it('never runs away on a degenerate viewport', () => {
        const ticks = chooseTimeTicks({ viewport: { ...VIEWPORT, fromMs: 0, toMs: 1 }, extentPx: 100_000, minimumSpacingPx: 96 });

        expect(ticks.length).toBeLessThanOrEqual(512);
    });
});

describe('tick density adapts to the label size', () => {
    it('fits more ticks when labels are narrow', () => {
        const wide = chooseTimeTicks({ viewport: VIEWPORT, extentPx: 400, minimumSpacingPx: 120 });
        const narrow = chooseTimeTicks({ viewport: VIEWPORT, extentPx: 400, minimumSpacingPx: 40 });

        expect(narrow.length).toBeGreaterThanOrEqual(wide.length);
    });

    it('still labels a narrow phone axis more than once', () => {
        const ticks = chooseTimeTicks({ viewport: VIEWPORT, extentPx: 330, minimumSpacingPx: 92 });

        expect(ticks.length).toBeGreaterThanOrEqual(2);
    });

    it('never crowds a short axis past its spacing', () => {
        const ticks = choosePriceTicks({ viewport: VIEWPORT, extentPx: 120, minimumSpacingPx: 60 });

        expect(ticks.length).toBeLessThanOrEqual(4);
    });
});

describe('the time step ladder has no wide gaps', () => {
    it('labels a quarter-hour window more than twice', () => {
        const quarterHour = { ...VIEWPORT, fromMs: 0, toMs: 900_000 };

        const ticks = chooseTimeTicks({ viewport: quarterHour, extentPx: 1_450, minimumSpacingPx: 100 });

        expect(ticks.length).toBeGreaterThanOrEqual(6);
    });

    it('labels an hour window more than twice', () => {
        const hour = { ...VIEWPORT, fromMs: 0, toMs: 3_600_000 };

        const ticks = chooseTimeTicks({ viewport: hour, extentPx: 1_450, minimumSpacingPx: 100 });

        expect(ticks.length).toBeGreaterThanOrEqual(6);
    });

    it('labels a day window more than twice', () => {
        const day = { ...VIEWPORT, fromMs: 0, toMs: 86_400_000 };

        const ticks = chooseTimeTicks({ viewport: day, extentPx: 1_450, minimumSpacingPx: 100 });

        expect(ticks.length).toBeGreaterThanOrEqual(6);
    });

    it('labels a narrow phone axis at least twice on every preset span', () => {
        const spans = [60_000, 300_000, 900_000, 3_600_000, 14_400_000, 86_400_000];

        const counts = spans.map((spanMs) => chooseTimeTicks({
            viewport: { ...VIEWPORT, fromMs: 0, toMs: spanMs },
            extentPx: 330,
            minimumSpacingPx: 92,
        }).length);

        expect(counts.every((count) => count >= 2)).toBe(true);
    });
});
