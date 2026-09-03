import { describe, expect, it } from 'vitest';
import { completePlan} from '../../../../../src/shared/core/draw-plan.ts';
import { resolvePlanRange } from '../../../../../src/app/painting/pane-projector.ts';
import { buildBar, buildWindow } from '../../../../mocks/price-bars.ts';
import { VOLUME } from '../../../../../src/app/indicators/volume/volume.ts';

const BARS = buildWindow([
    buildBar(0, 100, { openPrice: 95, buyVolume: 8, sellVolume: 2, tradeCount: 30 }),
    buildBar(60_000, 101, { openPrice: 105, buyVolume: 1, sellVolume: 9, tradeCount: 40 }),
]);

function compute(volumeMode: string) {
    const settings = { volumeMode };
    return completePlan(
        { indicatorId: 'volume', indicator: VOLUME, settings, warmupBarCount: 0 },
        VOLUME.compute({ bars: BARS, sessions: {}, settings }),
    );
}

describe('Volume', () => {
    it('adds both sides together when asked for the total', () => {
        const plan = compute('total');

        const spoken = [0, 1].map((bar) => plan.series
            .map((series) => series.value[bar]!)
            .filter(Number.isFinite));
        expect(spoken).toEqual([[10], [10]]);
    });

    it('colours each bar by where its own price ended up', () => {
        // The first bar closed above where it opened, the second below. The two
        // series between them cover every bar and never the same one twice.
        const plan = compute('total');

        const [rising, falling] = plan.series.map((series) => [...series.value]);
        expect(rising![0]).toBe(10);
        expect(rising![1]).toBeNaN();
        expect(falling![0]).toBeNaN();
        expect(falling![1]).toBe(10);
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
        // None rather than one: the fetch floors at one on its own, and a bar it
        // does not read must not decide whether it converged.
        expect((VOLUME as { resolveSources?: unknown }).resolveSources).toBeUndefined();
        expect(compute('total').hasConverged).toBe(true);
    });
});

describe('where volume is drawn', () => {
    it('lies along the floor of the price pane, costing it no height', () => {
        // What a reader expects to find, and where it takes only the floor it
        // was not reading anyway.
        expect(compute('total').scale).toEqual({ kind: 'overlay', heightRatio: 0.2 });
    });

    it('takes a band once it is showing two directions, which a strip has no room for', () => {
        expect(compute('sides').scale).toEqual({ kind: 'symmetric' });
    });
});
