import { describe, expect, it } from 'vitest';
import {
    countPanedPlans,
    isPriceScale,
    needsOwnBand,
    resolveOverlayRect,
    PaneProjector,
    placePanes,
    resolvePlanRange,
} from '../../../../src/app/painting/pane-projector.ts';
import type { DrawPlan, PlotScale } from '../../../../src/shared/core/draw-plan.ts';

let minted = 0;

function buildPlan(scale: PlotScale, values: readonly number[], levels: readonly number[] = []): DrawPlan {
    minted += 1;
    return {
        indicatorId: 'test',
        instanceId: `test-${minted}`,
        labelKey: 'indicator.rsi',
        parameterSummary: '14',
        scale,
        series: [{
            labelKey: 'indicator.rsi',
            tone: 'phosphor',
            shape: 'line',
            atMs: Float64Array.from(values.map((_, index) => index)),
            value: Float64Array.from(values),
        }],
        levels: levels.map((value) => ({ value, tone: 'muted' as const })),
        hasConverged: true,
    };
}

describe('resolvePlanRange', () => {
    it('keeps a declared range whatever the window happened to reach', () => {
        // The bounds are the reading. Rescaling to what an oscillator reached
        // this window makes forty look like an extreme.
        const plan = buildPlan({ kind: 'fixed', low: 0, high: 100 }, [45, 52, 48]);

        expect(resolvePlanRange(plan)).toEqual({ low: 0, high: 100 });
    });

    it('centres a signed reading on nought, so a rise and a fall are the same size', () => {
        const plan = buildPlan({ kind: 'symmetric' }, [-2, 8, 3]);

        expect(resolvePlanRange(plan)).toEqual({ low: -8, high: 8 });
    });

    it('leaves head-room around an automatic range so a peak is not clipped', () => {
        const plan = buildPlan({ kind: 'auto' }, [10, 20]);

        const range = resolvePlanRange(plan);

        expect(range.low).toBeLessThan(10);
        expect(range.high).toBeGreaterThan(20);
    });

    it('makes room for a threshold the data never reached', () => {
        // A line drawn outside the band is a threshold the reader cannot use.
        const plan = buildPlan({ kind: 'auto' }, [10, 12], [40]);

        expect(resolvePlanRange(plan).high).toBeGreaterThanOrEqual(40);
    });

    it('survives a plan that says nothing anywhere', () => {
        const plan = buildPlan({ kind: 'auto' }, [Number.NaN, Number.NaN]);

        expect(resolvePlanRange(plan)).toEqual({ low: 0, high: 1 });
    });
});

describe('PaneProjector', () => {
    it('puts the high at the top of the band and the low at the bottom', () => {
        const projector = new PaneProjector({
            rect: { topY: 100, height: 200 },
            low: 0,
            high: 100,
        });

        expect(projector.valueToY(100)).toBeLessThan(projector.valueToY(0));
    });

    it('keeps clear space at both edges, so a peak is not a line on the border', () => {
        const projector = new PaneProjector({
            rect: { topY: 100, height: 200 },
            low: 0,
            high: 100,
        });

        expect(projector.valueToY(100)).toBeGreaterThan(100);
        expect(projector.valueToY(0)).toBeLessThan(300);
    });
});

describe('placePanes', () => {
    it('pairs each paned plan with a band, skipping what shares the price axis', () => {
        const plans = [
            buildPlan({ kind: 'price' }, [1, 2]),
            buildPlan({ kind: 'fixed', low: 0, high: 100 }, [50]),
            buildPlan({ kind: 'symmetric' }, [-1, 1]),
        ];
        const panes = [{ topY: 400, height: 100 }, { topY: 500, height: 100 }];

        const placements = placePanes(plans, panes);

        expect(placements.map((placement) => placement.rect.topY)).toEqual([400, 500]);
        expect(placements[0]?.high).toBe(100);
    });

    it('drops a plan the layout found no room for rather than stacking two in one band', () => {
        const plans = [
            buildPlan({ kind: 'auto' }, [1]),
            buildPlan({ kind: 'auto' }, [2]),
        ];

        expect(placePanes(plans, [{ topY: 400, height: 100 }])).toHaveLength(1);
    });
});

describe('needsOwnBand', () => {
    it('grows the stack only for a reading that has nowhere else to go', () => {
        expect(needsOwnBand({ kind: 'auto' })).toBe(true);
        expect(needsOwnBand({ kind: 'fixed', low: 0, high: 100 })).toBe(true);
        expect(needsOwnBand({ kind: 'symmetric' })).toBe(true);
    });

    it('costs the price no height for a reading drawn along its floor', () => {
        // The distinction the price pane depends on: not being a price is not
        // the same as needing a band taken out of it.
        expect(needsOwnBand({ kind: 'price' })).toBe(false);
        expect(needsOwnBand({ kind: 'overlay', heightRatio: 0.2 })).toBe(false);
        expect(needsOwnBand(undefined)).toBe(false);
    });
});

describe('resolveOverlayRect', () => {
    it('lays the strip along the floor of the price pane', () => {
        const strip = resolveOverlayRect({ kind: 'overlay', heightRatio: 0.2 }, 500);

        expect(strip).toEqual({ topY: 400, height: 100 });
    });

    it('refuses to let a strip eat the pane it is drawn in', () => {
        const greedy = resolveOverlayRect({ kind: 'overlay', heightRatio: 5 }, 500);

        expect(greedy!.height).toBeLessThanOrEqual(250);
    });

    it('has nothing to lay out for a plan that asked for no strip', () => {
        expect(resolveOverlayRect({ kind: 'auto' }, 500)).toBeNull();
        expect(resolveOverlayRect(undefined, 500)).toBeNull();
    });
});

describe('isPriceScale', () => {
    it('reads a plan that declared nothing as belonging over the price', () => {
        // An addon may ship a plan built before scales existed, and the price
        // pane is the reading that leaves the chart intact.
        expect(isPriceScale(undefined)).toBe(true);
    });
});

describe('countPanedPlans', () => {
    it('counts only what needs a band, which is what sizes the stack', () => {
        const plans = [
            buildPlan({ kind: 'price' }, [1]),
            buildPlan({ kind: 'auto' }, [1]),
            buildPlan({ kind: 'fixed', low: 0, high: 1 }, [1]),
        ];

        expect(countPanedPlans(plans)).toBe(2);
    });

    it('counts a shared band once, however many are drawn in it', () => {
        const first = buildPlan({ kind: 'fixed', low: 0, high: 100 }, [40]);
        const plans = [first, { ...buildPlan({ kind: 'fixed', low: 0, high: 100 }, [60]), bandKey: first.instanceId! }];

        expect(countPanedPlans(plans)).toBe(1);
    });
});

describe('a shared band', () => {
    it('scales to cover everything drawn in it', () => {
        // Two readings side by side against different rulers is not a comparison.
        const first = buildPlan({ kind: 'auto' }, [0, 10]);
        const second = { ...buildPlan({ kind: 'auto' }, [0, 90]), bandKey: first.instanceId! };

        const placements = placePanes([first, second], [{ topY: 400, height: 100 }]);

        expect(placements).toHaveLength(1);
        expect(placements[0]!.high).toBeGreaterThanOrEqual(90);
    });

    it('keeps every threshold drawn in it, whichever member asked for one', () => {
        const first = buildPlan({ kind: 'fixed', low: 0, high: 100 }, [40], [70, 30]);
        const second = { ...buildPlan({ kind: 'fixed', low: 0, high: 100 }, [60], [50]), bandKey: first.instanceId! };

        const placements = placePanes([first, second], [{ topY: 400, height: 100 }]);

        expect(placements[0]!.levels.map((level) => level.value)).toEqual([70, 30, 50]);
    });
});
