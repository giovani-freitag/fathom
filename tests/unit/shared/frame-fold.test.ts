import { describe, expect, it } from 'vitest';
import { applyPriceBand, foldFrameWindow } from '../../../src/shared/core/frame-fold.ts';
import type { LiquidityFrameWindow } from '../../../src/shared/core/liquidity-frame.ts';

const CAPTURED_AT_MS = 1_700_000_000_000;

/** One instant on a ten dollar grid, with a wall standing well below the price. */
function buildWindow(priceBucketSize = 10): LiquidityFrameWindow {
    return {
        priceBucketSize,
        sampleIntervalMs: 1_000,
        frames: [{
            capturedAtMs: CAPTURED_AT_MS,
            bestBidPrice: 77_500,
            bestAskPrice: 77_510,
            bids: {
                lowestBucketIndex: 7_740,
                quantities: Float32Array.from([2, 0, 0, 0, 90, 0, 0, 0, 0, 0, 3]),
            },
            asks: { lowestBucketIndex: 7_760, quantities: Float32Array.from([4, 0, 7]) },
        }],
    };
}

/** What the folded frame says is resting at each row. */
function readByRow(window: LiquidityFrameWindow): Map<number, number> {
    const byRow = new Map<number, number>();
    const frame = window.frames[0]!;
    for (const ladder of [frame.bids, frame.asks]) {
        for (let index = 0; index < ladder.quantities.length; index += 1) {
            const quantity = ladder.quantities[index] ?? 0;
            if (quantity > 0) {
                byRow.set(ladder.lowestBucketIndex + index, quantity);
            }
        }
    }
    return byRow;
}

describe('foldFrameWindow', () => {
    it('hands back the same window when it is already on the grid', () => {
        const window = buildWindow();

        expect(foldFrameWindow(window, 10)).toBe(window);
    });

    it('reports the grid it was asked for', () => {
        expect(foldFrameWindow(buildWindow(), 50)?.priceBucketSize).toBe(50);
    });

    it('gathers the prices into rows of the coarser grid', () => {
        // Five prices held over a fivefold grid land on three rows.
        const folded = foldFrameWindow(buildWindow(), 50);

        expect(readByRow(folded!).size).toBe(3);
    });

    it('keeps the largest of a row, so a wall is not averaged away', () => {
        // The ninety sits with four empty prices; a mean would draw it as
        // eighteen, and a wall is the one thing a wide band is opened to see.
        const folded = foldFrameWindow(buildWindow(), 50);

        expect(Math.max(...readByRow(folded!).values())).toBe(90);
    });

    it('puts a row where its prices were, not where the fine index pointed', () => {
        // Read on the fine grid, the wall at bucket 7,744 would be drawn at
        // seventy-seven thousand four hundred and forty rather than at its price.
        const folded = foldFrameWindow(buildWindow(), 50);
        const wallRow = [...readByRow(folded!)].find(([, size]) => size === 90)?.[0];

        expect((wallRow ?? 0) * 50).toBe(77_400);
    });

    it('refuses a grid finer than the one it holds', () => {
        // Nothing can be unfolded: the prices inside a row were thrown away when
        // it was made, and inventing them would draw a book that never stood.
        expect(foldFrameWindow(buildWindow(), 5)).toBeNull();
    });

    it('refuses a grid the rows do not divide into', () => {
        // Rows that straddle the ones already drawn put every wall a little off.
        expect(foldFrameWindow(buildWindow(), 25)).toBeNull();
    });

    it('keeps the bids below the touch and the asks above it', () => {
        const folded = foldFrameWindow(buildWindow(), 50)!;
        const frame = folded.frames[0]!;

        expect(frame.bids.lowestBucketIndex + frame.bids.quantities.length - 1)
            .toBeLessThan(frame.asks.lowestBucketIndex);
    });

    it('folds a price sharing the touch row into it, as the store does', () => {
        // On a coarse grid the row holding the touch holds both sides of it.
        // Splitting on the fine grid instead would put that row whole on one
        // side, and the same instant would read differently drawn than stored.
        const tight = buildWindow();
        const near = {
            ...tight,
            frames: [{
                ...tight.frames[0]!,
                asks: { lowestBucketIndex: 7_751, quantities: Float32Array.from([4]) },
            }],
        };

        const folded = foldFrameWindow(near, 50)!;

        expect(folded.frames[0]!.asks.quantities).toHaveLength(0);
    });

    it('carries the instant and the touch prices through untouched', () => {
        const frame = foldFrameWindow(buildWindow(), 50)!.frames[0]!;

        expect([frame.capturedAtMs, frame.bestBidPrice, frame.bestAskPrice])
            .toEqual([CAPTURED_AT_MS, 77_500, 77_510]);
    });
});

describe('applyPriceBand', () => {
    /** The whole window, unclipped, as a store that ignores the band answers. */
    const whole = buildWindow();

    it('hands back the window untouched when no band was named', () => {
        expect(applyPriceBand(whole, null)).toBe(whole);
    });

    it('drops the prices the reader will not draw', () => {
        const band = { lowestBucketIndex: 7_744, bucketCount: 8, bucketsPerRow: 1 };

        const held = readByRow(applyPriceBand(whole, band));

        expect([...held.keys()].filter((row) => row < 7_744 || row >= 7_752)).toEqual([]);
    });

    it('keeps the prices it does draw', () => {
        const band = { lowestBucketIndex: 7_744, bucketCount: 8, bucketsPerRow: 1 };

        expect(readByRow(applyPriceBand(whole, band)).get(7_744)).toBe(90);
    });

    it('reports the grid the fold put it on', () => {
        const band = { lowestBucketIndex: 7_740, bucketCount: 40, bucketsPerRow: 5 };

        expect(applyPriceBand(whole, band).priceBucketSize).toBe(50);
    });

    it('keeps the largest of a folded row, so a wall is not averaged away', () => {
        const band = { lowestBucketIndex: 7_740, bucketCount: 40, bucketsPerRow: 5 };

        expect(Math.max(...readByRow(applyPriceBand(whole, band)).values())).toBe(90);
    });

    it('leaves the instant and the touch prices alone', () => {
        const band = { lowestBucketIndex: 7_740, bucketCount: 40, bucketsPerRow: 5 };
        const frame = applyPriceBand(whole, band).frames[0]!;

        expect([frame.capturedAtMs, frame.bestBidPrice]).toEqual([CAPTURED_AT_MS, 77_500]);
    });
});
