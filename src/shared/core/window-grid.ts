/**
 * The grid a read lays a window on.
 *
 * One definition rather than one per store. A server and a page answer the same
 * question out of different archives, and the answer only fits together if both
 * put it on the same grid: a window and the tail extending it, or the columns a
 * reader already holds and the ones a pan just asked for. Written twice, the two
 * copies drift, and what that draws is not an error anywhere — it is columns at
 * instants that never happened, beside columns at instants that did.
 */

/** What a read is asked for, as much of it as the grid depends on. */
export interface WindowGridQuery {
    readonly fromMs: number;
    readonly toMs: number;
    readonly maxColumns: number;
}

/**
 * How much time one drawn column stands for.
 *
 * @param query - The stretch asked for and the columns there is room to draw.
 * @returns The interval, never less than one millisecond.
 */
export function resolveSampleInterval(query: WindowGridQuery): number {
    const rangeMs = Math.max(1, query.toMs - query.fromMs);
    return Math.max(1, Math.ceil(rangeMs / Math.max(1, query.maxColumns)));
}

/**
 * The start of the interval an instant falls in.
 *
 * @param instantMs - The instant to place.
 * @param intervalMs - What one interval covers.
 * @returns The instant the interval opens at.
 */
export function alignDown(instantMs: number, intervalMs: number): number {
    return Math.floor(instantMs / intervalMs) * intervalMs;
}

/**
 * The start of the interval after an instant, or the instant when it opens one.
 *
 * @param instantMs - The instant to place.
 * @param intervalMs - What one interval covers.
 * @returns The instant that interval opens at.
 */
export function alignUp(instantMs: number, intervalMs: number): number {
    return Math.ceil(instantMs / intervalMs) * intervalMs;
}
