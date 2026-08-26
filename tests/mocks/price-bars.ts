import type { PriceBar, PriceBarWindow } from '../../src/shared/core/price-bar.ts';

export const BAR_INTERVAL_MS = 60_000;

export interface BarOptions {
    readonly highPrice?: number;
    readonly lowPrice?: number;
    readonly openPrice?: number;
}

/**
 * One closed bar on the shared interval.
 *
 * @param openedAtMs - When the bucket opened.
 * @param closePrice - Where it closed, which is also its default extent.
 * @param options - Anything the test wants to differ from a flat bar.
 * @returns The bar.
 */
export function buildBar(openedAtMs: number, closePrice: number, options: BarOptions = {}): PriceBar {
    return {
        openedAtMs,
        closedAtMs: openedAtMs + BAR_INTERVAL_MS,
        openPrice: options.openPrice ?? closePrice,
        highPrice: options.highPrice ?? closePrice,
        lowPrice: options.lowPrice ?? closePrice,
        closePrice,
        expectedFrames: 60,
        frameCount: 60,
        isClosed: true,
        firstFrameAtMs: openedAtMs,
        lastFrameAtMs: openedAtMs + 59_000,
    };
}

/**
 * A window around a run of bars.
 *
 * @param bars - The bars, oldest first.
 * @param warmupBarsReturned - How many of them are seed rather than drawn.
 * @returns The window an indicator is given.
 */
export function buildWindow(bars: readonly PriceBar[], warmupBarsReturned = 0): PriceBarWindow {
    return {
        instrumentSymbol: 'BTCUSDT',
        intervalMs: BAR_INTERVAL_MS,
        warmupBarsRequested: warmupBarsReturned,
        warmupBarsReturned,
        bars: [...bars],
    };
}

/**
 * Consecutive bars a fixed step apart, priced by their position.
 *
 * @param count - How many.
 * @param price - The close of the bar at each index.
 * @param startIndex - Where in the timeline the run begins.
 * @returns The bars, oldest first.
 */
export function buildRun(
    count: number,
    price: (index: number) => number,
    startIndex = 0,
): PriceBar[] {
    return Array.from({ length: count }, (_, offset) => {
        const index = startIndex + offset;
        const closePrice = price(offset);
        return buildBar(index * BAR_INTERVAL_MS, closePrice, {
            // A range around the close, so the indicators that read the extent
            // of a bar have something other than a flat line to read.
            highPrice: closePrice + 1,
            lowPrice: closePrice - 1,
        });
    });
}
