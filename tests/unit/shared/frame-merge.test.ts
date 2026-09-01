import { clipToRegion, mergeFrameWindows } from '../../../src/shared/core/frame-merge.ts';
import { describe, expect, it } from 'vitest';
import type { LiquidityFrame, LiquidityFrameWindow } from '../../../src/shared/core/liquidity-frame.ts';

const BUCKET_SIZE = 10;
const TOUCH_BUCKET = 7_900;

/** One instant holding a run of prices, on whichever side of the touch it falls. */
function buildFrame(capturedAtMs: number, lowestBucketIndex: number, sizes: number[]): LiquidityFrame {
    const held = new Map<number, number>();
    sizes.forEach((size, offset) => { held.set(lowestBucketIndex + offset, size); });
    const bids = [...held].filter(([bucket]) => bucket <= TOUCH_BUCKET).sort((a, b) => a[0] - b[0]);
    const asks = [...held].filter(([bucket]) => bucket > TOUCH_BUCKET).sort((a, b) => a[0] - b[0]);
    const toLadder = (entries: [number, number][]) => {
        const lowest = entries[0]?.[0] ?? 0;
        const highest = entries.at(-1)?.[0] ?? -1;
        const quantities = new Float32Array(Math.max(0, highest - lowest + 1));
        for (const [bucket, size] of entries) { quantities[bucket - lowest] = size; }
        return { lowestBucketIndex: entries.length === 0 ? 0 : lowest, quantities };
    };
    return {
        capturedAtMs,
        bestBidPrice: TOUCH_BUCKET * BUCKET_SIZE,
        bestAskPrice: (TOUCH_BUCKET + 1) * BUCKET_SIZE,
        bids: toLadder(bids),
        asks: toLadder(asks),
    };
}

function buildWindow(frames: LiquidityFrame[], priceBucketSize = BUCKET_SIZE): LiquidityFrameWindow {
    return { priceBucketSize, sampleIntervalMs: 1_000, frames };
}

/** What one window says is resting at each price, at each instant. */
function readCells(window: LiquidityFrameWindow): Map<string, number> {
    const cells = new Map<string, number>();
    for (const frame of window.frames) {
        for (const ladder of [frame.bids, frame.asks]) {
            for (let index = 0; index < ladder.quantities.length; index += 1) {
                const quantity = ladder.quantities[index] ?? 0;
                if (quantity > 0) {
                    cells.set(`${String(frame.capturedAtMs)}:${String(ladder.lowestBucketIndex + index)}`, quantity);
                }
            }
        }
    }
    return cells;
}

describe('laying one reading over another', () => {
    it('holds every price both pieces held for the same instant', () => {
        // A reader that already has a stretch of prices and asks for the ones
        // beside them gets a piece of a picture back, not a picture.
        const below = buildWindow([buildFrame(1_000, 7_850, [1, 2, 3])]);
        const above = buildWindow([buildFrame(1_000, 7_920, [4, 5, 6])]);

        const merged = mergeFrameWindows([below, above]);

        expect([...readCells(merged!).keys()].sort()).toEqual([
            '1000:7850', '1000:7851', '1000:7852', '1000:7920', '1000:7921', '1000:7922',
        ]);
    });

    it('holds every instant the pieces cover between them', () => {
        const earlier = buildWindow([buildFrame(1_000, 7_890, [1])]);
        const later = buildWindow([buildFrame(2_000, 7_890, [2])]);

        const merged = mergeFrameWindows([earlier, later]);

        expect(merged?.frames.map((frame) => frame.capturedAtMs)).toEqual([1_000, 2_000]);
    });

    it('keeps the larger where two pieces read the same price', () => {
        const one = buildWindow([buildFrame(1_000, 7_890, [3])]);
        const other = buildWindow([buildFrame(1_000, 7_890, [7])]);

        const merged = mergeFrameWindows([one, other]);

        expect(readCells(merged!).get('1000:7890')).toBe(7);
    });

    it('refuses pieces on another grid rather than laying them side by side', () => {
        // Two grids are two pictures of the same market at two resolutions, and
        // rows of one beside rows of the other put walls at prices nobody offered.
        const fine = buildWindow([buildFrame(1_000, 7_890, [1])]);
        const coarse = buildWindow([buildFrame(1_000, 1_972, [1])], 40);

        expect(mergeFrameWindows([fine, coarse])).toBeNull();
    });

    it('splits the merged prices at the touch, so the book is not one-sided', () => {
        // Four prices from 7,898, with the touch at 7,900: three at or below
        // it and one above.
        const both = buildWindow([buildFrame(1_000, 7_898, [1, 2, 3, 4])]);

        const merged = mergeFrameWindows([both]);

        const frame = merged?.frames[0];
        expect([frame?.bids.quantities.length, frame?.asks.quantities.length]).toEqual([3, 1]);
    });
});

describe('taking the part of a window a reader asked for', () => {
    it('drops the instants outside the stretch', () => {
        const window = buildWindow([
            buildFrame(1_000, 7_890, [1]), buildFrame(2_000, 7_890, [1]), buildFrame(3_000, 7_890, [1]),
        ]);

        const clipped = clipToRegion(window, {
            fromMs: 2_000, toMs: 3_000, lowPrice: 0, highPrice: 1_000_000,
        });

        expect(clipped.frames.map((frame) => frame.capturedAtMs)).toEqual([2_000, 3_000]);
    });

    it('drops the prices outside the band', () => {
        // Handed over whole, the prices outside the view are not merely wasteful:
        // a fold or a colour scale computed from them is computed from prices
        // nobody is looking at.
        const window = buildWindow([buildFrame(1_000, 7_890, [1, 1, 1, 1, 1, 1])]);

        const clipped = clipToRegion(window, {
            fromMs: 0, toMs: 9_000, lowPrice: 78_920, highPrice: 78_940,
        });

        expect([...readCells(clipped).keys()].sort()).toEqual(['1000:7892', '1000:7893', '1000:7894']);
    });
});
