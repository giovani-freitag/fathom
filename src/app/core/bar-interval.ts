/**
 * The rungs a bar may be drawn on.
 *
 * A closed ladder rather than an arithmetic step: a bar has to be the same
 * everywhere, and an interval computed from the surface makes it a property of
 * the browser window.
 *
 * Every rung is one the venue publishes a candle for. It used to start at a
 * second, from when bars were built out of the recorded book; a bar comes from
 * the venue now, and offering a width no venue serves would be offering a rung
 * that answers with nothing.
 */
export const BAR_INTERVALS_MS = [
    60_000, 300_000, 900_000, 1_800_000,
    3_600_000, 14_400_000, 86_400_000,
] as const;

export type BarIntervalMs = (typeof BAR_INTERVALS_MS)[number];

/**
 * Bars a window aims to show.
 *
 * Bars rather than pixels: it is what makes a rung the same decision on a phone
 * and on a desktop, and it is what a named rung widens the window to fit.
 */
export const TARGET_BAR_COUNT = 240;

/** Where the ladder ends; a span wider than this still gets bars, just fewer. */
const COARSEST_INTERVAL_MS: BarIntervalMs = 86_400_000;

export interface BarIntervalRequest {
    readonly viewportSpanMs: number;
    /** Bars the reader should see across the window, not pixels. */
    readonly targetBarCount: number;
}

/**
 * The rung that fits a window.
 *
 * @param request - The span to cover and how many bars to cover it with.
 * @returns A member of the ladder, never a computed number.
 */
export function chooseBarIntervalMs(request: BarIntervalRequest): BarIntervalMs {
    const wanted = request.viewportSpanMs / Math.max(1, request.targetBarCount);

    // The finest rung that still fits the count asked for, so a window shows at
    // most that many bars. Taking the coarsest rung *under* the wanted width
    // instead overshoots the count and draws bars too thin to read as bars.
    return BAR_INTERVALS_MS.find((rung) => rung >= wanted) ?? COARSEST_INTERVAL_MS;
}

/**
 * The rung to draw on, honouring a reader who named one.
 *
 * @param chosen - The rung the reader named, or null to let the window decide.
 * @param request - The span to cover and how many bars to cover it with.
 * @returns A member of the ladder, never a computed number.
 */
export function resolveBarIntervalMs(
    chosen: BarIntervalMs | null,
    request: BarIntervalRequest,
): BarIntervalMs {
    return chosen ?? chooseBarIntervalMs(request);
}

/** The value the interval choices carry while the window is deciding for itself. */
export const AUTOMATIC_INTERVAL = 'auto';
