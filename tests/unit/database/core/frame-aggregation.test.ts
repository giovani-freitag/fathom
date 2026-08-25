import { describe, expect, it } from 'vitest';
import { foldFramesIntoColumns } from '../../../../src/database/core/frame-aggregation.ts';
import type { LiquidityFrame } from '../../../../src/shared/core/liquidity-frame.ts';

function buildFrame(
    capturedAtMs: number,
    bidQuantities: number[],
    lowestBucketIndex = 100,
): LiquidityFrame {
    return {
        capturedAtMs,
        bestBidPrice: 1_000,
        bestAskPrice: 1_002,
        bids: { lowestBucketIndex, quantities: Float32Array.from(bidQuantities) },
        asks: { lowestBucketIndex: lowestBucketIndex + 10, quantities: Float32Array.from([1]) },
    };
}

describe('foldFramesIntoColumns', () => {
    it('returns nothing for no frames', () => {
        expect(foldFramesIntoColumns([], 4_000)).toEqual([]);
    });

    it('leaves a lone instant untouched', () => {
        const frames = [buildFrame(1_000, [10, 20])];

        expect([...foldFramesIntoColumns(frames, 4_000)[0]!.bids.quantities]).toEqual([10, 20]);
    });

    it('averages the instants that share a column', () => {
        const frames = [buildFrame(0, [10]), buildFrame(1_000, [30])];

        expect(foldFramesIntoColumns(frames, 4_000)[0]!.bids.quantities[0]).toBe(20);
    });

    it('fades a level that was only there for part of the column', () => {
        const frames = [
            buildFrame(0, [100]),
            buildFrame(1_000, [0]),
            buildFrame(2_000, [0]),
            buildFrame(3_000, [0]),
        ];

        expect(foldFramesIntoColumns(frames, 4_000)[0]!.bids.quantities[0]).toBe(25);
    });

    it('keeps a level that rested through the whole column at full size', () => {
        const frames = [
            buildFrame(0, [100]),
            buildFrame(1_000, [100]),
            buildFrame(2_000, [100]),
            buildFrame(3_000, [100]),
        ];

        expect(foldFramesIntoColumns(frames, 4_000)[0]!.bids.quantities[0]).toBe(100);
    });

    it('separates instants that fall in different columns', () => {
        const frames = [buildFrame(0, [10]), buildFrame(5_000, [30])];

        expect(foldFramesIntoColumns(frames, 4_000).length).toBe(2);
    });

    it('files the folded frame at the start of its column', () => {
        const frames = [buildFrame(4_500, [10]), buildFrame(5_500, [30])];

        expect(foldFramesIntoColumns(frames, 4_000)[0]!.capturedAtMs).toBe(4_000);
    });

    it('aligns ladders that start at different buckets', () => {
        const frames = [buildFrame(0, [10, 10], 100), buildFrame(1_000, [10, 10], 101)];

        const folded = foldFramesIntoColumns(frames, 4_000)[0]!.bids;
        expect([folded.lowestBucketIndex, [...folded.quantities]]).toEqual([100, [5, 10, 5]]);
    });

    it('averages the touch prices as well as the depth', () => {
        const frames = [
            { ...buildFrame(0, [10]), bestBidPrice: 1_000 },
            { ...buildFrame(1_000, [10]), bestBidPrice: 1_010 },
        ];

        expect(foldFramesIntoColumns(frames, 4_000)[0]!.bestBidPrice).toBe(1_005);
    });

    it('hands the frames back untouched when there is no column to fold into', () => {
        const frames = [buildFrame(0, [10]), buildFrame(1_000, [30])];

        expect(foldFramesIntoColumns(frames, 0).length).toBe(2);
    });

    it('survives a ladder with no buckets at all', () => {
        const frames = [buildFrame(0, []), buildFrame(1_000, [])];

        expect(foldFramesIntoColumns(frames, 4_000)[0]!.bids.quantities.length).toBe(0);
    });
});
