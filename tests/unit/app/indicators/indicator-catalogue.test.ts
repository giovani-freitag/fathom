import { describe, expect, it } from 'vitest';
import { INDICATOR_CATALOGUE, readDefaultSettings } from '../../../../src/app/indicators/indicator-catalogue.ts';
import { isPlanWithinBudget } from '../../../../src/shared/core/draw-plan.ts';
import type { Indicator } from '../../../../src/shared/core/draw-plan.ts';
import { BAR_INTERVAL_MS, buildRun, buildWindow } from '../../../mocks/price-bars.ts';

/** A run long enough that every shipped indicator has converged inside it. */
const RUN_LENGTH = 200;

function computeOver(indicator: Indicator, bars: ReturnType<typeof buildRun>) {
    return indicator.compute({
        bars: buildWindow(bars),
        warmupBarCount: 0,
        settings: readDefaultSettings(indicator),
    });
}

/** A wandering price, so nothing passes by being constant. */
function wander(index: number): number {
    return 100 + Math.sin(index / 7) * 12 + index * 0.3;
}

describe('every shipped indicator', () => {
    it.each(INDICATOR_CATALOGUE.map((indicator) => [indicator.id, indicator] as const))(
        '%s draws a plan the host will accept',
        (_id, indicator) => {
            const bars = buildRun(RUN_LENGTH, wander);

            const plan = computeOver(indicator, bars);

            expect(isPlanWithinBudget(plan)).toBe(true);
            expect(plan.series.every((series) => series.value.length === bars.length)).toBe(true);
        },
    );

    it.each(INDICATOR_CATALOGUE.map((indicator) => [indicator.id, indicator] as const))(
        '%s reads nothing across a hole in the recording',
        (_id, indicator) => {
            // The strongest statement of the rule: what is drawn after a gap must
            // be exactly what would be drawn if the bars before it had never
            // existed. Anything else is a reading of time nobody recorded.
            const after = buildRun(RUN_LENGTH, wander, 10_000);
            const across = [...buildRun(RUN_LENGTH, wander), ...after];

            const whole = computeOver(indicator, across);
            const alone = computeOver(indicator, after);

            const tail = whole.series.map((series) => [...series.value.slice(RUN_LENGTH)]);
            expect(tail).toEqual(alone.series.map((series) => [...series.value]));
        },
    );

    it.each(
        INDICATOR_CATALOGUE
            .filter((indicator) => indicator.scale.kind === 'fixed')
            .map((indicator) => [indicator.id, indicator] as const),
    )('%s stays inside the bounds it declared', (_id, indicator) => {
        const scale = indicator.scale as { low: number; high: number };

        const plan = computeOver(indicator, buildRun(RUN_LENGTH, wander));

        const values = plan.series.flatMap((series) => [...series.value]).filter(Number.isFinite);
        expect(Math.min(...values)).toBeGreaterThanOrEqual(scale.low);
        expect(Math.max(...values)).toBeLessThanOrEqual(scale.high);
    });

    it.each(INDICATOR_CATALOGUE.map((indicator) => [indicator.id, indicator] as const))(
        '%s clamps a setting from outside its declared range',
        (_id, indicator) => {
            // Settings survive in storage past the control that produced them, so
            // a figure no current control can produce still has to arrive safely.
            const wild = Object.fromEntries(
                indicator.parameters.map((parameter) => [parameter.name, -1_000]),
            );

            const plan = indicator.compute({
                bars: buildWindow(buildRun(RUN_LENGTH, wander)),
                warmupBarCount: 0,
                settings: wild,
            });

            const values = plan.series.flatMap((series) => [...series.value]);
            expect(values.every((value) => Number.isNaN(value) || Number.isFinite(value))).toBe(true);
        },
    );

    it('offers every indicator under an id of its own', () => {
        const ids = INDICATOR_CATALOGUE.map((indicator) => indicator.id);

        expect(new Set(ids).size).toBe(ids.length);
    });

    it('plots against the same instants the bars closed at', () => {
        const bars = buildRun(20, wander);

        const plan = computeOver(INDICATOR_CATALOGUE[0]!, bars);

        expect(plan.series[0]?.atMs[0]).toBe(bars[0]!.openedAtMs + BAR_INTERVAL_MS);
    });
});
