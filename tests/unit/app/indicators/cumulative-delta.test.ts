import { describe, expect, it } from 'vitest';
import { NO_HIGHER_BARS } from '../../../../src/shared/core/draw-plan.ts';
import { CUMULATIVE_DELTA } from '../../../../src/app/indicators/cumulative-delta/cumulative-delta.ts';
import { buildRun, buildWindow } from '../../../mocks/price-bars.ts';

/** A run whose aggression is dictated bar by bar. */
function computeOver(flows: readonly [number, number][]) {
    const bars = buildRun(flows.length, (index) => 100 + index).map((bar, index) => ({
        ...bar,
        buyVolume: flows[index]![0],
        sellVolume: flows[index]![1],
    }));
    return CUMULATIVE_DELTA.compute({
        bars: buildWindow(bars),
        warmupBarCount: 0,
        higher: NO_HIGHER_BARS,
        settings: {},
    });
}

describe('CumulativeDelta', () => {
    it('adds what was bought and takes off what was sold', () => {
        const plan = computeOver([[3, 1], [2, 0], [0, 4]]);

        expect([...plan.series[0]!.value]).toEqual([2, 4, 0]);
    });

    it('starts from nought at the first bar drawn', () => {
        const plan = computeOver([[5, 0], [1, 1]]);

        expect(plan.series[0]!.value[0]).toBe(5);
    });

    it('needs nothing before the window, which is why it can start there', () => {
        expect(CUMULATIVE_DELTA.resolveWarmupBars()).toBe(0);
    });

    it('marks the line the aggression changes hands on', () => {
        const plan = computeOver([[1, 0]]);

        expect(plan.levels?.map((level) => level.value)).toEqual([0]);
    });

    it('starts again across a stretch nothing was recorded through', () => {
        // Adding what traded either side of a hole would draw a step nobody
        // traded, and a step is exactly what this reading is read for.
        const bars = buildRun(4, (index) => 100 + index).map((bar, index) => ({
            ...bar,
            buyVolume: 2,
            sellVolume: 0,
            // The third bar opens later than the second closed: a hole.
            openedAtMs: index >= 2 ? bar.openedAtMs + 60_000 : bar.openedAtMs,
            closedAtMs: index >= 2 ? bar.closedAtMs + 60_000 : bar.closedAtMs,
        }));

        const plan = CUMULATIVE_DELTA.compute({
            bars: buildWindow(bars),
            warmupBarCount: 0,
            higher: NO_HIGHER_BARS,
            settings: {},
        });

        expect([...plan.series[0]!.value]).toEqual([2, 4, 2, 4]);
    });

    it('reads on a scale of its own, being a size and not a price', () => {
        expect(CUMULATIVE_DELTA.scale.kind).not.toBe('price');
    });

    it('counts a quiet bar as nought rather than as missing', () => {
        // A bar the book was recorded through with nobody trading is quiet, and
        // a line that broke there would read as an unrecorded stretch.
        const plan = computeOver([[2, 0], [0, 0], [1, 0]]);

        expect([...plan.series[0]!.value]).toEqual([2, 2, 3]);
    });
});
