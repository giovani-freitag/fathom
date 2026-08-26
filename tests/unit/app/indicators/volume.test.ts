import { describe, expect, it } from 'vitest';
import { resolvePlanRange } from '../../../../src/app/painting/pane-projector.ts';
import { buildBar, buildWindow } from '../../../mocks/price-bars.ts';
import { VOLUME } from '../../../../src/app/indicators/volume.ts';

const BARS = buildWindow([
    buildBar(0, 100, { buyVolume: 8, sellVolume: 2, tradeCount: 30 }),
    buildBar(60_000, 101, { buyVolume: 1, sellVolume: 9, tradeCount: 40 }),
]);

function compute(mode: string) {
    return VOLUME.compute({ bars: BARS, warmupBarCount: 0, settings: { mode } });
}

describe('Volume', () => {
    it('adds both sides together when asked for the total', () => {
        const plan = compute('total');

        expect([...plan.series[0]!.value]).toEqual([10, 10]);
    });

    it('draws the two sides against each other rather than stacking them', () => {
        // Stacked, a bar of eight bought and two sold looks exactly like two
        // bought and eight sold, which is the one thing the recording knows.
        const plan = compute('sides');

        expect([...plan.series[0]!.value]).toEqual([8, 1]);
        expect([...plan.series[1]!.value]).toEqual([-2, -9]);
    });

    it('centres the split on nought, so a buy and a sell of one size read alike', () => {
        const plan = compute('sides');

        const range = resolvePlanRange(plan);
        expect(range.low).toBe(-range.high);
    });

    it('rests the total on nought rather than floating above it', () => {
        // Head-room below would put a negative size on the axis, which is not a
        // thing a size can be.
        const plan = compute('total');

        expect(resolvePlanRange(plan).low).toBe(0);
    });

    it('needs no history behind the window, because it carries nothing between bars', () => {
        expect(VOLUME.resolveWarmupBars()).toBe(1);
        expect(compute('total').hasConverged).toBe(true);
    });
});
