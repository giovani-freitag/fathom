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

const PRICE_TICK_SPACING_PX = 64;
const TIME_TICK_SPACING_PX = 96;

/** Ticks past this count mean a degenerate viewport, not a dense axis. */
const MAXIMUM_TICKS = 512;

/**
 * Prices to label on the vertical axis.
 *
 * @param viewport - The visible slice of time and price.
 * @param plotHeight - Height of the plot area, in CSS pixels.
 * @returns Ascending prices, spaced on a round step.
 */
export function choosePriceTicks(viewport: ChartViewport, plotHeight: number): number[] {
    const span = viewport.highPrice - viewport.lowPrice;
    if (span <= 0) {
        return [];
    }

    const targetCount = Math.max(2, Math.floor(plotHeight / PRICE_TICK_SPACING_PX));
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
 * @param viewport - The visible slice of time and price.
 * @param plotWidth - Width of the plot area, in CSS pixels.
 * @returns Ascending instants, spaced on a calendar-friendly step.
 */
export function chooseTimeTicks(viewport: ChartViewport, plotWidth: number): number[] {
    const spanMs = viewport.toMs - viewport.fromMs;
    if (spanMs <= 0) {
        return [];
    }

    const targetCount = Math.max(2, Math.floor(plotWidth / TIME_TICK_SPACING_PX));
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
