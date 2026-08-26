import type { DrawPlan, PlotScale } from '../../shared/core/draw-plan.ts';
import type { PanePlacement, PaneRect } from './render-types.ts';

/**
 * Anything that can turn a value into a vertical position.
 *
 * The price pane and an indicator's own pane answer this differently, and a
 * painter that only needs a y should not have to know which it was handed.
 */
export interface ValueProjector {
    valueToY(value: number): number;
}

/** Clear space kept at the top and bottom of a pane, as a share of its height. */
const PANE_INSET_RATIO = 0.08;

export interface PaneProjectorConfig {
    readonly rect: PaneRect;
    readonly low: number;
    readonly high: number;
}

/**
 * Places a value inside one pane of the stack.
 */
export class PaneProjector implements ValueProjector {
    private readonly topY: number;
    private readonly drawableHeight: number;
    private readonly low: number;
    private readonly span: number;

    constructor(config: PaneProjectorConfig) {
        const inset = config.rect.height * PANE_INSET_RATIO;
        this.topY = config.rect.topY + inset;
        this.drawableHeight = Math.max(1, config.rect.height - inset * 2);
        this.low = config.low;
        this.span = Math.max(Number.EPSILON, config.high - config.low);
    }

    /**
     * The vertical position a value sits at inside the pane.
     *
     * @param value - The value, in whatever units the indicator works in.
     * @returns A y in surface pixels.
     */
    valueToY(value: number): number {
        return this.topY + ((this.high - value) / this.span) * this.drawableHeight;
    }

    private get high(): number {
        return this.low + this.span;
    }
}

export interface ValueRange {
    readonly low: number;
    readonly high: number;
}

/** Head-room above and below an automatic range, so a peak is not clipped. */
const AUTOMATIC_RANGE_PADDING = 0.1;

/**
 * The value range one plan should be drawn against.
 *
 * A bounded indicator keeps its declared range whatever the data did, because
 * the bounds are the reading: an oscillator rescaled to what it happened to
 * reach this window makes 40 look like an extreme.
 *
 * @param plan - The plan being placed.
 * @returns The low and high of its pane.
 */
export function resolvePlanRange(plan: DrawPlan): ValueRange {
    if (plan.scale.kind === 'fixed') {
        return { low: plan.scale.low, high: plan.scale.high };
    }

    const observed = measureObservedRange(plan);
    if (observed === null) {
        return { low: 0, high: 1 };
    }
    if (plan.scale.kind === 'symmetric') {
        const reach = Math.max(Math.abs(observed.low), Math.abs(observed.high), Number.EPSILON);
        return { low: -reach, high: reach };
    }

    const padding = Math.max((observed.high - observed.low) * AUTOMATIC_RANGE_PADDING, Number.EPSILON);
    return { low: observed.low - padding, high: observed.high + padding };
}

/**
 * The extremes a plan's own series reached, levels included.
 *
 * Levels count because a threshold drawn outside the pane is a threshold the
 * reader cannot use.
 */
function measureObservedRange(plan: DrawPlan): ValueRange | null {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;

    for (const series of plan.series) {
        for (const value of series.value) {
            if (Number.isFinite(value)) {
                low = Math.min(low, value);
                high = Math.max(high, value);
            }
        }
        if (series.baseline !== undefined) {
            low = Math.min(low, series.baseline);
            high = Math.max(high, series.baseline);
        }
    }
    for (const level of plan.levels ?? []) {
        low = Math.min(low, level.value);
        high = Math.max(high, level.value);
    }

    return low > high ? null : { low, high };
}

/**
 * Whether a plan is drawn over the price rather than in a pane of its own.
 *
 * @param scale - The plan's declared scale, absent where nothing declared one.
 * @returns True when it shares the price axis, which is what an absent scale gets.
 */
export function isPriceScale(scale: PlotScale | undefined): boolean {
    return scale === undefined || scale.kind === 'price';
}

/**
 * How many plans need a band of their own, which is what sizes the pane stack.
 *
 * @param plans - What the indicators produced for the window on screen.
 * @returns The pane count.
 */
export function countPanedPlans(plans: readonly DrawPlan[]): number {
    return plans.filter((plan) => !isPriceScale(plan.scale)).length;
}

/**
 * Pairs each paned plan with the band it will be drawn in.
 *
 * @param plans - What the indicators produced, in the order they were added.
 * @param panes - The bands the layout allocated, top to bottom.
 * @returns One placement per band that has a plan for it.
 */
export function placePanes(
    plans: readonly DrawPlan[],
    panes: readonly PaneRect[],
): readonly PanePlacement[] {
    const placements: PanePlacement[] = [];
    let paneIndex = 0;

    for (const plan of plans) {
        if (isPriceScale(plan.scale)) {
            continue;
        }
        const rect = panes[paneIndex];
        paneIndex += 1;
        if (rect !== undefined) {
            placements.push({ rect, ...resolvePlanRange(plan), levels: plan.levels ?? [] });
        }
    }

    return placements;
}
