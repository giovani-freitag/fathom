import type { PriceBar } from '../../../shared/core/price-bar.ts';

/**
 * The newest coarser bar that had already closed, for each bar of a window.
 *
 * This is the whole of what reading a coarser rung honestly amounts to. A daily
 * level drawn on a minute chart is a level the day *before* agreed on, and the
 * day being drawn through has not finished having its say: taking the figures
 * off a bar that is still forming shows the reader, at nine in the morning,
 * something that will not be true until midnight.
 *
 * A bar closing exactly when a drawn bar opens counts as settled. That is the
 * instant it became knowable, and holding it back a bar would draw yesterday's
 * level a minute into today.
 *
 * @param bars - The window being drawn, oldest first.
 * @param higher - Bars of the coarser rung, oldest first.
 * @returns One entry per drawn bar, undefined where nothing had closed yet.
 */
export function holdLastClosed(
    bars: readonly PriceBar[],
    higher: readonly PriceBar[],
): readonly (PriceBar | undefined)[] {
    const held: (PriceBar | undefined)[] = [];
    let cursor = 0;
    let settled: PriceBar | undefined;

    // One walk of each, not a search per bar: both are in order, so the coarser
    // cursor only ever moves forward.
    for (const bar of bars) {
        while (cursor < higher.length && higher[cursor]!.closedAtMs <= bar.openedAtMs) {
            settled = higher[cursor]!;
            cursor += 1;
        }
        held.push(settled);
    }

    return held;
}
