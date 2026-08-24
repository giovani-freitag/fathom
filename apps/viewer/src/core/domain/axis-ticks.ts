import type { ChartViewport } from './chart-viewport.ts';

/** Steps a price axis is allowed to land on, scaled by powers of ten. */
const PRICE_TICK_STEPS = [1, 2, 2.5, 5, 10];

/**
 * Steps a time axis is allowed to land on.
 *
 * Fixed rather than derived so labels fall on whole seconds, minutes, and hours;
 * a computed step lands at 37-second intervals and reads as noise.
 */
const TIME_TICK_STEPS_MS = [
    1_000, 5_000, 15_000, 30_000,
    60_000, 300_000, 900_000, 1_800_000,
    3_600_000, 10_800_000, 21_600_000, 43_200_000,
    86_400_000, 172_800_000, 604_800_000,
];

/** Ticks past this count mean a degenerate viewport, not a dense axis. */
const MAXIMUM_TICKS = 512;

/**
 * What an axis needs to space its ticks.
 *
 * The spacing is passed in rather than fixed because a label's width depends on
 * the font the surface is drawing with: a phone renders shorter labels in a
 * smaller face, and a constant tuned for a desktop leaves it with one tick.
 */
export interface TickRequest {
    readonly viewport: ChartViewport;
    /** Length of the axis in CSS pixels: width for time, height for price. */
    readonly extentPx: number;
    readonly minimumSpacingPx: number;
}

/**
 * Prices to label on the vertical axis.
 *
 * @param request - The viewport, the axis length, and the spacing to respect.
 * @returns Ascending prices, spaced on a round step.
 */
export function choosePriceTicks(request: TickRequest): number[] {
    const { viewport, extentPx, minimumSpacingPx } = request;
    const span = viewport.highPrice - viewport.lowPrice;
    if (span <= 0) {
        return [];
    }

    const targetCount = Math.max(2, Math.floor(extentPx / Math.max(1, minimumSpacingPx)));
    const step = chooseNicePriceStep(span / targetCount);

    const ticks: number[] = [];
    const firstTick = Math.ceil(viewport.lowPrice / step) * step;
    for (let price = firstTick; price <= viewport.highPrice && ticks.length < MAXIMUM_TICKS; price += step) {
        ticks.push(price);
    }
    return ticks;
}

/**
 * Instants to label on the horizontal axis.
 *
 * @param request - The viewport, the axis length, and the spacing to respect.
 * @returns Ascending instants, spaced on a calendar-friendly step.
 */
export function chooseTimeTicks(request: TickRequest): number[] {
    const { viewport, extentPx, minimumSpacingPx } = request;
    const spanMs = viewport.toMs - viewport.fromMs;
    if (spanMs <= 0) {
        return [];
    }

    const targetCount = Math.max(2, Math.floor(extentPx / Math.max(1, minimumSpacingPx)));
    const desiredStep = spanMs / targetCount;
    const step = TIME_TICK_STEPS_MS.find((candidate) => candidate >= desiredStep)
        ?? TIME_TICK_STEPS_MS[TIME_TICK_STEPS_MS.length - 1]!;

    const ticks: number[] = [];
    const firstTick = Math.ceil(viewport.fromMs / step) * step;
    for (let at = firstTick; at <= viewport.toMs && ticks.length < MAXIMUM_TICKS; at += step) {
        ticks.push(at);
    }
    return ticks;
}

/**
 * Nearest round step at or above a raw spacing.
 *
 * @param rawStep - The spacing an even division would produce.
 * @returns A step of the form 1, 2, 2.5, 5, or 10 times a power of ten.
 */
export function chooseNicePriceStep(rawStep: number): number {
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, Number.EPSILON)));
    const normalised = rawStep / magnitude;
    const step = PRICE_TICK_STEPS.find((candidate) => candidate >= normalised) ?? 10;
    return step * magnitude;
}
