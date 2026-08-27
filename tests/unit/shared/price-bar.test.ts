import { describe, expect, it } from 'vitest';
import { BAR_BUDGET, keepNewestBars, type PriceBar } from '../../../src/shared/core/price-bar.ts';

/** One bar, distinguishable only by when it opened. */
function buildBar(openedAtMs: number): PriceBar {
    return {
        openedAtMs,
        closedAtMs: openedAtMs + 1_000,
        openPrice: 100,
        highPrice: 101,
        lowPrice: 99,
        closePrice: 100,
        buyVolume: 0,
        sellVolume: 0,
        tradeCount: 0,
        expectedFrames: 1,
        frameCount: 1,
        isClosed: true,
        firstFrameAtMs: openedAtMs,
        lastFrameAtMs: openedAtMs,
    };
}

/** A run of bars a second apart, oldest first. */
function buildRun(count: number): PriceBar[] {
    return Array.from({ length: count }, (unused, index) => buildBar(index * 1_000));
}

describe('keepNewestBars', () => {
    it('keeps a run that fits whole', () => {
        const bars = buildRun(10);

        expect(keepNewestBars(bars)).toEqual(bars);
    });

    it('keeps a run of exactly the budget whole', () => {
        expect(keepNewestBars(buildRun(BAR_BUDGET.maximumBars))).toHaveLength(BAR_BUDGET.maximumBars);
    });

    it('returns no more than the budget', () => {
        expect(keepNewestBars(buildRun(BAR_BUDGET.maximumBars + 500)))
            .toHaveLength(BAR_BUDGET.maximumBars);
    });

    it('gives up the oldest bars rather than the newest', () => {
        // Trimmed from the other end, a reader who pinned a fine interval and
        // zoomed out is handed the oldest stretch of the range and a blank right
        // edge, which is exactly where the price is.
        const bars = buildRun(BAR_BUDGET.maximumBars + 500);

        expect(keepNewestBars(bars).at(-1)).toEqual(bars.at(-1));
    });

    it('still returns them oldest first', () => {
        const kept = keepNewestBars(buildRun(BAR_BUDGET.maximumBars + 500));

        expect(kept[0]!.openedAtMs).toBeLessThan(kept.at(-1)!.openedAtMs);
    });

    it('does not hand back the array it was given', () => {
        const bars = buildRun(3);

        expect(keepNewestBars(bars)).not.toBe(bars);
    });
});
