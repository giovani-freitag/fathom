import { describe, expect, it } from 'vitest';
import { VOLUME_DELTA } from '../../../../src/app/indicators/volume-delta/volume-delta.ts';
import { recolourPlan, NO_HIGHER_BARS } from '../../../../src/shared/core/draw-plan.ts';
import { buildRun, buildWindow } from '../../../mocks/price-bars.ts';

/** A run whose aggression is dictated bar by bar, as `[bought, sold]`. */
function computeOver(flows: readonly [number, number][]) {
    const bars = buildRun(flows.length, (index) => 100 + index).map((bar, index) => ({
        ...bar,
        buyVolume: flows[index]![0],
        sellVolume: flows[index]![1],
    }));
    return VOLUME_DELTA.compute({
        bars: buildWindow(bars),
        warmupBarCount: 0,
        higher: NO_HIGHER_BARS,
        settings: {},
    });
}

describe('VolumeDelta', () => {
    it('takes what was sold off what was bought', () => {
        const plan = computeOver([[3, 1], [2, 0], [0, 4]]);

        expect([...plan.series[0]!.value]).toEqual([2, 2, -4]);
    });

    it('answers each bar from itself, carrying nothing forward', () => {
        // The same three bars added up would climb 2, 4, 6. What separates this
        // reading from the running total is that it does not.
        const plan = computeOver([[2, 0], [2, 0], [2, 0]]);

        expect([...plan.series[0]!.value]).toEqual([2, 2, 2]);
    });

    it('counts a quiet bar as nought rather than as missing', () => {
        const plan = computeOver([[2, 0], [0, 0], [1, 0]]);

        expect([...plan.series[0]!.value]).toEqual([2, 0, 1]);
    });

    it('stays true either side of a stretch nothing was recorded through', () => {
        // Nothing accumulates here, so a hole costs this reading nothing —
        // which is why it does not walk the window in segments.
        const bars = buildRun(4, (index) => 100 + index).map((bar, index) => ({
            ...bar,
            buyVolume: 3,
            sellVolume: 1,
            openedAtMs: index >= 2 ? bar.openedAtMs + 60_000 : bar.openedAtMs,
            closedAtMs: index >= 2 ? bar.closedAtMs + 60_000 : bar.closedAtMs,
        }));

        const plan = VOLUME_DELTA.compute({
            bars: buildWindow(bars),
            warmupBarCount: 0,
            higher: NO_HIGHER_BARS,
            settings: {},
        });

        expect([...plan.series[0]!.value]).toEqual([2, 2, 2, 2]);
    });

    it('grows either side of nought rather than off the floor', () => {
        const plan = computeOver([[1, 0]]);

        expect(plan.series[0]!.baseline).toBe(0);
    });

    it('draws a sold bar in a different colour from a bought one', () => {
        const series = computeOver([[0, 5]]).series[0]!;

        // The tone the painter resolves below the baseline. Absent a negative
        // tone it falls back to the positive one, which is the whole bug.
        expect(series.negativeTone ?? series.tone).not.toBe(series.tone);
    });

    it('keeps its colours when a copy is tinted, because they are the reading', () => {
        const plan = computeOver([[3, 1]]);

        const tinted = recolourPlan(plan, 'violet');

        expect(tinted.series[0]!.tone).toBe(plan.series[0]!.tone);
    });

    it('scales the two sides alike, so an imbalance shows as one', () => {
        expect(VOLUME_DELTA.scale.kind).toBe('symmetric');
    });

    it('needs nothing before the window, each bar being answered from itself', () => {
        expect(VOLUME_DELTA.resolveWarmupBars()).toBe(0);
    });

    it('marks the line the aggression changes hands on', () => {
        const plan = computeOver([[1, 0]]);

        expect(plan.levels?.map((level) => level.value)).toEqual([0]);
    });
});
