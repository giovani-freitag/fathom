import type { DrawPlan, PlotSeries } from '../../shared/core/draw-plan.ts';
import {
    groupPanedPlans,
    needsOwnBand,
    PaneProjector,
    resolveOverlayRect,
    resolvePlanRange,
    type ValueProjector,
} from './pane-projector.ts';
import type { ChartViewport } from '../core/chart-viewport.ts';
import type { ChartLayout, PanePlacement } from './render-types.ts';
import type { ViewportProjector } from '../core/viewport-projector.ts';

/**
 * How near the pointer has to be, in CSS pixels, to land on a plotted line.
 *
 * Tighter than a mark a reader drew: a chart may carry several readings at once
 * and they cross each other constantly, so a generous reach would answer with
 * whichever happened to be nearest rather than the one being pointed at.
 */
export const PLAN_GRAB_TOLERANCE_PX = 10;

export interface PlanHitRequest {
    readonly plans: readonly DrawPlan[];
    readonly viewport: ChartViewport;
    readonly layout: ChartLayout;
    /** What maps price and time to the price pane. */
    readonly projector: ViewportProjector;
    /** The bands the paned plans were drawn in, in the order they were placed. */
    readonly panePlacements: readonly PanePlacement[];
    readonly point: { readonly x: number; readonly y: number };
}

/**
 * Which added layer is drawn under the pointer, if any.
 *
 * @param request - What is drawn, where the pointer is, and how it was placed.
 * @returns The instance id of the nearest reading within reach, or null.
 */
export function findPlanAt(request: PlanHitRequest): string | null {
    let nearestId: string | null = null;
    let nearestDistance = PLAN_GRAB_TOLERANCE_PX;

    for (const plan of request.plans) {
        const projector = resolveProjector(plan, request);
        if (projector === null || plan.instanceId === undefined) {
            continue;
        }

        for (const series of plan.series) {
            const distance = measureSeriesDistance(series, projector, request);
            if (distance !== null && distance < nearestDistance) {
                nearestDistance = distance;
                nearestId = plan.instanceId;
            }
        }
    }
    return nearestId;
}

/**
 * What turns one plan's values into the pixels it was drawn at.
 *
 * Resolved the same three ways the painter resolves them, because a hit test
 * that placed a reading anywhere else would answer about a line nobody can see.
 */
function resolveProjector(plan: DrawPlan, request: PlanHitRequest): ValueProjector | null {
    if (needsOwnBand(plan.scale)) {
        return resolvePaneProjector(plan, request);
    }

    const strip = resolveOverlayRect(plan.scale, request.layout.pricePaneHeight);
    if (strip === null) {
        return request.projector;
    }
    return new PaneProjector({ rect: strip, ...resolvePlanRange(plan, request.viewport) });
}

/**
 * The band a paned plan was placed in, as something that can project into it.
 */
function resolvePaneProjector(plan: DrawPlan, request: PlanHitRequest): ValueProjector | null {
    const bands = groupPanedPlans(request.plans);
    const index = bands.findIndex((band) => band.includes(plan));
    const placement = request.panePlacements[index];
    return placement === undefined ? null : new PaneProjector(placement);
}

/**
 * How far the pointer is from one plotted series, in pixels.
 *
 * @returns The distance, or null where the series has nothing on screen there.
 */
function measureSeriesDistance(
    series: PlotSeries,
    projector: ValueProjector,
    request: PlanHitRequest,
): number | null {
    const index = findNearestIndex(series.atMs, request.projector.xToTime(request.point.x));
    if (index === null) {
        return null;
    }

    let nearest: number | null = null;
    // The sample either side as well: what is drawn between two of them is a
    // segment, and the pointer is almost never on one of its ends.
    for (const at of [index - 1, index, index + 1]) {
        const distance = measureSampleDistance({ series, projector, request, index: at });
        if (distance !== null && (nearest === null || distance < nearest)) {
            nearest = distance;
        }
    }
    return nearest;
}

/**
 * How far the pointer is from what one sample actually draws.
 *
 * A dot is measured to itself rather than to the run between it and the next:
 * nothing is drawn along that run, and a tap answered by a line nobody can see
 * opens the settings of a reading the reader was not pointing at.
 */
function measureSampleDistance(sample: SampleDistanceRequest): number | null {
    if (sample.series.shape === 'histogram') {
        return measureBarDistance(sample);
    }
    if (sample.series.shape === 'dot') {
        const at = placeSample(sample, sample.index);
        return at === null
            ? null
            : Math.hypot(at.x - sample.request.point.x, at.y - sample.request.point.y);
    }
    return measureSegmentDistance(sample);
}

/**
 * How far the pointer is from the segment drawn out of one sample.
 */
function measureSegmentDistance(sample: SampleDistanceRequest): number | null {
    const from = placeSample(sample, sample.index);
    const to = placeSample(sample, sample.index + 1);
    if (from === null) {
        return null;
    }
    if (to === null) {
        return Math.hypot(from.x - sample.request.point.x, from.y - sample.request.point.y);
    }
    return measurePointToSegment(sample.request.point, from, to);
}

/**
 * How far the pointer is from the bar drawn at one sample.
 *
 * A histogram is pointed at as a bar rather than as the line along its top, so
 * anywhere between its baseline and its value counts as on it.
 */
function measureBarDistance(sample: SampleDistanceRequest): number | null {
    const top = placeSample(sample, sample.index);
    if (top === null) {
        return null;
    }

    const baselineY = sample.projector.valueToY(sample.series.baseline ?? 0);
    const { point } = sample.request;
    return Math.hypot(
        Math.max(top.x - point.x - halfColumnWidth(sample), 0, point.x - top.x - halfColumnWidth(sample)),
        Math.max(Math.min(top.y, baselineY) - point.y, 0, point.y - Math.max(top.y, baselineY)),
    );
}

/**
 * Half the pixels between two samples, which is how wide a bar is drawn.
 */
function halfColumnWidth(sample: SampleDistanceRequest): number {
    const { atMs } = sample.series;
    const first = atMs[0];
    const second = atMs[1];
    if (first === undefined || second === undefined) {
        return 0;
    }
    return Math.abs(sample.request.projector.timeToX(second)
        - sample.request.projector.timeToX(first)) / 2;
}

/**
 * Where one sample of a series was drawn.
 *
 * @returns The point, or null where the series says nothing at that sample.
 */
function placeSample(sample: SampleDistanceRequest, index: number): Placed | null {
    const value = sample.series.value[index];
    const atMs = sample.series.atMs[index];
    if (value === undefined || atMs === undefined) {
        return null;
    }
    // A gap in the reading is a NaN, and it is left to travel through the
    // arithmetic: a distance of NaN is never nearer than the tolerance, which
    // is the same answer a line broken there gives a reader.
    return { x: sample.request.projector.timeToX(atMs), y: sample.projector.valueToY(value) };
}

/**
 * How far a point is from a line segment, in pixels.
 */
function measurePointToSegment(point: Placed, from: Placed, to: Placed): number {
    const runX = to.x - from.x;
    const runY = to.y - from.y;
    const lengthSquared = runX * runX + runY * runY;
    if (lengthSquared === 0) {
        return Math.hypot(point.x - from.x, point.y - from.y);
    }

    const along = Math.min(1, Math.max(0,
        ((point.x - from.x) * runX + (point.y - from.y) * runY) / lengthSquared));
    return Math.hypot(point.x - (from.x + along * runX), point.y - (from.y + along * runY));
}

/** One sample of one series, as the thing to measure the pointer against. */
interface SampleDistanceRequest {
    readonly series: PlotSeries;
    readonly projector: ValueProjector;
    readonly request: PlanHitRequest;
    readonly index: number;
}

/** A point on the surface. */
interface Placed {
    readonly x: number;
    readonly y: number;
}

/**
 * The sample nearest an instant, in a series whose instants ascend.
 *
 * @param atMs - The series' instants.
 * @param target - The instant to look for.
 * @returns The index, or null when the series is empty.
 */
function findNearestIndex(atMs: Float64Array, target: number): number | null {
    if (atMs.length === 0) {
        return null;
    }

    let low = 0;
    let high = atMs.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (atMs[middle]! < target) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}
