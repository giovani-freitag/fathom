import { describe, expect, it } from 'vitest';
import type { LiquidityFrame } from '../../../../../src/shared/core/liquidity-frame.ts';
import { DepthRowFolder } from '../../../../../src/app/indicators/book/depth-row-folder.ts';

const HIGHEST_BUCKET_INDEX = 11;

function buildFolder(bucketsPerBand: number, rowCount = 3): DepthRowFolder {
    return new DepthRowFolder({ rowCount, highestBucketIndex: HIGHEST_BUCKET_INDEX, bucketsPerBand });
}

/** One instant whose two sides rest at the buckets given. */
function buildFrame(bids: [number, readonly number[]], asks: [number, readonly number[]]): LiquidityFrame {
    return {
        capturedAtMs: 0,
        bestBidPrice: 0,
        bestAskPrice: 0,
        bids: { lowestBucketIndex: bids[0], quantities: Float32Array.from(bids[1]) },
        asks: { lowestBucketIndex: asks[0], quantities: Float32Array.from(asks[1]) },
    };
}

describe('DepthRowFolder', () => {
    it('gives every bucket a row of its own while none are folded', () => {
        const folder = buildFolder(1, 12);

        expect(folder.rowOf(HIGHEST_BUCKET_INDEX) - folder.rowOf(HIGHEST_BUCKET_INDEX - 1)).toBe(-1);
    });

    it('puts the buckets of one band in the same row', () => {
        const folder = buildFolder(4);

        expect(folder.rowOf(8)).toBe(folder.rowOf(11));
    });

    it('starts the next band at the next row', () => {
        const folder = buildFolder(4);

        expect(folder.rowOf(7)).toBe(folder.rowOf(8) + 1);
    });

    it('keeps the biggest wall in a band rather than its total', () => {
        // Totalled, a wall would dim as the window widened and the empty prices
        // either side of it were counted in with it — which is the moment a
        // reader most needs to see where the wall is.
        const folder = buildFolder(4);

        folder.fold(buildFrame([8, [1, 1, 9, 1]], [12, [0]]));

        expect(folder.quantityAt(0)).toBe(9);
    });

    it('folds both sides of the book into the same rows', () => {
        const folder = buildFolder(4);

        folder.fold(buildFrame([4, [5]], [8, [3]]));

        expect([folder.quantityAt(0), folder.quantityAt(1)]).toEqual([3, 5]);
    });

    it('answers the rows it reached, so only those are drawn', () => {
        const folder = buildFolder(4);

        expect(folder.fold(buildFrame([4, [5]], [8, [3]]))).toEqual({ lowRow: 0, highRow: 1 });
    });

    it('answers nothing for an instant with nothing resting anywhere', () => {
        const folder = buildFolder(4);

        expect(folder.fold(buildFrame([4, [0]], [8, [0]]))).toBeNull();
    });

    it('drops a price the image does not reach down to', () => {
        const folder = buildFolder(4, 1);

        expect(folder.fold(buildFrame([0, [5]], [1, [5]]))).toBeNull();
    });

    it('empties what it reached, so the next column starts clean', () => {
        const folder = buildFolder(4);
        const touched = folder.fold(buildFrame([8, [9]], [12, [0]]))!;

        folder.clear(touched);

        expect(folder.quantityAt(0)).toBe(0);
    });

    it('leaves rows it did not reach alone, which is what makes clearing cheap', () => {
        const folder = buildFolder(4);
        folder.fold(buildFrame([4, [5]], [8, [3]]));

        folder.clear({ lowRow: 0, highRow: 0 });

        expect(folder.quantityAt(1)).toBe(5);
    });
});
