import { describe, expect, it } from 'vitest';
import type { DrawPlan, PlotSeries } from '../../../../src/shared/core/draw-plan.ts';
import { findPlanAt, type PlanHitRequest } from '../../../../src/app/painting/plan-hit-test.ts';
import { resolveChartLayout } from '../../../../src/app/painting/chart-layout.ts';
import { countPanedPlans, PaneProjector, placePanes } from '../../../../src/app/painting/pane-projector.ts';
import { ViewportProjector } from '../../../../src/app/core/viewport-projector.ts';

const VIEWPORT = { fromMs: 0, toMs: 100_000, lowPrice: 0, highPrice: 100 };
const CSS_WIDTH = 1_000;
const CSS_HEIGHT = 600;

/** A flat line at one value, sampled across the whole window. */
function buildSeries(value: number, overrides: Partial<PlotSeries> = {}): PlotSeries {
    return {
        labelKey: 'indicator.sma',
        tone: 'amber',
        shape: 'line',
        atMs: Float64Array.from([0, 25_000, 50_000, 75_000, 100_000]),
        value: Float64Array.from([value, value, value, value, value]),
        ...overrides,
    };
}

function buildPlan(instanceId: string, series: PlotSeries, scale: DrawPlan['scale']): DrawPlan {
    return {
        indicatorId: 'sma',
        instanceId,
        labelKey: 'indicator.sma',
        parameterSummary: '20',
        hasConverged: true,
        scale,
        series: [series],
    };
}

function buildRequest(plans: readonly DrawPlan[], point: { x: number; y: number }): PlanHitRequest {
    const layout = resolveChartLayout({
        cssWidth: CSS_WIDTH,
        cssHeight: CSS_HEIGHT,
        isVolumeProfileVisible: false,
        indicatorPaneCount: countPanedPlans(plans),
    });
    return {
        plans,
        viewport: VIEWPORT,
        layout,
        projector: new ViewportProjector({
            viewport: VIEWPORT,
            width: layout.plotWidth,
            height: layout.pricePaneHeight,
        }),
        panePlacements: placePanes(plans, layout.indicatorPanes, VIEWPORT),
        point,
    };
}

/** Where a price sits in the price pane of that layout. */
function yOf(price: number, request: PlanHitRequest): number {
    return request.projector.priceToY(price);
}

/** Halfway across the plot, wherever the price axis happens to start. */
function midX(request: PlanHitRequest): number {
    return request.projector.timeToX(50_000);
}

describe('findPlanAt', () => {
    const overPrice = buildPlan('sma-1', buildSeries(50), { kind: 'price' });

    it('answers which reading is drawn under the pointer', () => {
        const request = buildRequest([overPrice], { x: 500, y: 0 });

        expect(findPlanAt({ ...request, point: { x: midX(request), y: yOf(50, request) } })).toBe('sma-1');
    });

    it('answers between two samples, where what is drawn is the line joining them', () => {
        // The pointer is almost never on a sample: what a reader points at is
        // the segment, and measuring to the ends alone answers with nothing
        // wherever the samples are further apart than the reach.
        const request = buildRequest([overPrice], { x: 0, y: 0 });
        const between = request.projector.timeToX(37_500);

        expect(findPlanAt({ ...request, point: { x: between, y: yOf(50, request) } })).toBe('sma-1');
    });

    it('answers nothing where no reading is drawn', () => {
        const request = buildRequest([overPrice], { x: 500, y: 0 });

        expect(findPlanAt({ ...request, point: { x: midX(request), y: yOf(10, request) } })).toBeNull();
    });

    it('lets the pointer be a few pixels off the line', () => {
        const request = buildRequest([overPrice], { x: 500, y: 0 });

        expect(findPlanAt({ ...request, point: { x: midX(request), y: yOf(50, request) + 4 } })).toBe('sma-1');
    });

    it('answers the nearer of two readings that cross each other', () => {
        // A chart carries several readings at once and they cross constantly, so
        // a generous reach would answer with whichever happened to be nearest.
        const other = buildPlan('sma-2', buildSeries(52), { kind: 'price' });
        const request = buildRequest([overPrice, other], { x: 500, y: 0 });

        expect(findPlanAt({ ...request, point: { x: midX(request), y: yOf(52, request) } })).toBe('sma-2');
    });

    it('says nothing about a reading with nothing to say at that instant', () => {
        const broken = buildPlan('sma-1', buildSeries(50, {
            value: Float64Array.from([50, NaN, NaN, NaN, 50]),
        }), { kind: 'price' });
        const request = buildRequest([broken], { x: 500, y: 0 });

        expect(findPlanAt({ ...request, point: { x: midX(request), y: yOf(50, request) } })).toBeNull();
    });

    it("finds a reading drawn in a band of its own, on that band's own scale", () => {
        const paned = buildPlan('rsi-1', buildSeries(70), { kind: 'fixed', low: 0, high: 100 });
        const request = buildRequest([paned], { x: 500, y: 0 });
        const placement = request.panePlacements[0]!;
        const y = new PaneProjector(placement).valueToY(70);

        expect(findPlanAt({ ...request, point: { x: midX(request), y } })).not.toBeNull();
    });

    it('counts anywhere between a bar and its baseline as on it', () => {
        // A histogram is pointed at as a bar, not as the line along its top.
        const bars = buildPlan('volume-1', buildSeries(80, { shape: 'histogram', baseline: 0 }), {
            kind: 'price',
        });
        const request = buildRequest([bars], { x: 500, y: 0 });

        expect(findPlanAt({ ...request, point: { x: midX(request), y: yOf(40, request) } })).toBe('volume-1');
    });

    it('says nothing about a plan the host never stamped a copy onto', () => {
        const unstamped = buildPlan('sma-1', buildSeries(50), { kind: 'price' });
        const anonymous: DrawPlan = Object.fromEntries(
            Object.entries(unstamped).filter(([name]) => name !== 'instanceId'),
        ) as DrawPlan;
        const request = buildRequest([anonymous], { x: 500, y: 0 });

        expect(findPlanAt({ ...request, point: { x: midX(request), y: yOf(50, request) } })).toBeNull();
    });
});
