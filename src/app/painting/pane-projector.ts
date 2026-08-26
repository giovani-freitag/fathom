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
    return {
        // Head-room below nought would read as a negative quantity on the axis,
        // which is not a thing a size can be.
        low: observed.low >= 0 ? Math.max(0, observed.low - padding) : observed.low - padding,
        high: observed.high + padding,
    };
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
 * Whether a plan needs a band of the stack to itself.
 *
 * Distinct from not being a price: a reading drawn along the floor of the price
 * pane is not on the price's axis either, and still costs the price no height.
 *
 * @param scale - The plan's declared scale.
 * @returns True when the stack has to grow to hold it.
 */
export function needsOwnBand(scale: PlotScale | undefined): boolean {
    return scale !== undefined && scale.kind !== 'price' && scale.kind !== 'overlay';
}

/**
 * The strip along the floor of the price pane a plan was given.
 *
 * @param scale - The plan's declared scale.
 * @param pricePaneHeight - How tall the price pane is.
 * @returns The strip, or null when the plan asked for no such thing.
 */
export function resolveOverlayRect(
    scale: PlotScale | undefined,
    pricePaneHeight: number,
): PaneRect | null {
    if (scale === undefined || scale.kind !== 'overlay') {
        return null;
    }
    const height = pricePaneHeight * Math.min(Math.max(scale.heightRatio, 0.05), 0.5);
    return { topY: pricePaneHeight - height, height };
}

/**
 * The plans that need a band, gathered into the bands they share.
 *
 * Bands come out in the order their first member was added, so moving one
 * indicator into another's band does not shuffle the rest of the stack.
 *
 * @param plans - What the indicators produced for the window on screen.
 * @returns One group per band, top to bottom.
 */
export function groupPanedPlans(plans: readonly DrawPlan[]): readonly (readonly DrawPlan[])[] {
    const bands = new Map<string, DrawPlan[]>();

    plans.forEach((plan, index) => {
        if (!needsOwnBand(plan.scale)) {
            return;
        }
        // A plan nobody stamped stands alone. Falling back to the indicator's
        // own id would merge two copies of it that were never put together.
        const key = plan.bandKey ?? plan.instanceId ?? `plan-${index}`;
        const band = bands.get(key);
        if (band === undefined) {
            bands.set(key, [plan]);
            return;
        }
        band.push(plan);
    });

    return [...bands.values()];
}

/**
 * How many bands the stack needs.
 *
 * @param plans - What the indicators produced for the window on screen.
 * @returns The pane count.
 */
export function countPanedPlans(plans: readonly DrawPlan[]): number {
    return groupPanedPlans(plans).length;
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

    groupPanedPlans(plans).forEach((band, index) => {
        const rect = panes[index];
        if (rect !== undefined) {
            placements.push({ rect, ...resolveBandRange(band), levels: band.flatMap((plan) => plan.levels ?? []) });
        }
    });

    return placements;
}

/**
 * The range a band is scaled to, covering everything drawn in it.
 *
 * Two readings sharing a band have to share its scale, or the comparison the
 * reader put them together for is between two different rulers.
 */
function resolveBandRange(band: readonly DrawPlan[]): ValueRange {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;

    for (const plan of band) {
        const range = resolvePlanRange(plan);
        low = Math.min(low, range.low);
        high = Math.max(high, range.high);
    }

    return low > high ? { low: 0, high: 1 } : { low, high };
}
