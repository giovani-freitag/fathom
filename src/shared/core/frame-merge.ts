import type { LiquidityFrame, LiquidityFrameWindow } from './liquidity-frame.ts';
import { toLadders } from './frame-fold.ts';

/**
 * Several readings of the same instants, laid over one another.
 *
 * A reader that already holds part of what it is asking for reads only the
 * rest, and what comes back is a piece of a picture rather than a picture: a
 * stretch of time it did not have, or a stretch of prices it did not have over
 * time it did. Neither is a window on its own. This is what makes them one.
 *
 * Refuses rather than guesses when the pieces are not on the same grid. Two
 * grids are two pictures of the same market at different resolutions, and rows
 * of one laid beside rows of the other put walls at prices nobody offered.
 *
 * @param pieces - Windows to lay over one another, in any order.
 * @returns One window holding every price each piece held, or null when they
 *          are not on the same grid.
 */
export function mergeFrameWindows(
    pieces: readonly LiquidityFrameWindow[],
): LiquidityFrameWindow | null {
    const carried = pieces.filter((piece) => piece.frames.length > 0);
    const first = carried[0];
    if (first === undefined) {
        return pieces[0] ?? null;
    }
    const stranger = carried.find((piece) => piece.priceBucketSize !== first.priceBucketSize
        || piece.sampleIntervalMs !== first.sampleIntervalMs);
    if (stranger !== undefined) {
        return null;
    }

    const byInstant = new Map<number, Map<number, number>>();
    const touches = new Map<number, LiquidityFrame>();
    for (const piece of carried) {
        for (const frame of piece.frames) {
            const held = byInstant.get(frame.capturedAtMs) ?? new Map<number, number>();
            byInstant.set(frame.capturedAtMs, held);
            touches.set(frame.capturedAtMs, frame);
            gatherInto(held, frame);
        }
    }

    const frames = [...byInstant.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([capturedAtMs, held]) => buildFrame(touches.get(capturedAtMs)!, held, first));
    return { ...first, frames };
}

/** Everything one instant says is resting, added to what is already known of it. */
function gatherInto(held: Map<number, number>, frame: LiquidityFrame): void {
    for (const ladder of [frame.bids, frame.asks]) {
        for (let index = 0; index < ladder.quantities.length; index += 1) {
            const quantity = ladder.quantities[index] ?? 0;
            if (quantity <= 0) {
                continue;
            }
            const bucketIndex = ladder.lowestBucketIndex + index;
            // Largest wins where two pieces overlap. They are readings of the
            // same instant, so they agree; where a fold has rounded them apart,
            // a wall that either of them saw is a wall.
            held.set(bucketIndex, Math.max(held.get(bucketIndex) ?? 0, quantity));
        }
    }
}

/** One instant rebuilt from every price gathered for it, split at its touch. */
function buildFrame(
    touch: LiquidityFrame,
    held: Map<number, number>,
    grid: LiquidityFrameWindow,
): LiquidityFrame {
    const touchBucket = Math.floor(touch.bestBidPrice / grid.priceBucketSize);
    return {
        capturedAtMs: touch.capturedAtMs,
        bestBidPrice: touch.bestBidPrice,
        bestAskPrice: touch.bestAskPrice,
        ...toLadders(held, touchBucket),
    };
}

/** The instants and prices one reading covers. */
export interface FrameRegion {
    readonly fromMs: number;
    readonly toMs: number;
    readonly lowPrice: number;
    readonly highPrice: number;
}

/**
 * The window a reader asked for, taken out of a larger one.
 *
 * A window kept from an earlier read reaches further than the one being asked
 * for, and handing all of it over would draw prices and instants outside the
 * view — which is only wasteful, until a fold or a colour scale is computed
 * from them and it stops being only wasteful.
 *
 * @param window - The window held.
 * @param region - The instants and prices wanted out of it.
 * @returns The part of it inside that region.
 */
export function clipToRegion(
    window: LiquidityFrameWindow,
    region: FrameRegion,
): LiquidityFrameWindow {
    const lowest = Math.floor(region.lowPrice / window.priceBucketSize);
    const highest = Math.ceil(region.highPrice / window.priceBucketSize);
    const frames = window.frames
        .filter((frame) => frame.capturedAtMs >= region.fromMs && frame.capturedAtMs <= region.toMs)
        .map((frame) => clipFrame(frame, {
            lowest, highest, priceBucketSize: window.priceBucketSize,
        }));
    return { ...window, frames };
}

/** The buckets a clip keeps, on the grid they are counted in. */
interface ClipBand {
    readonly lowest: number;
    readonly highest: number;
    readonly priceBucketSize: number;
}

/** One instant holding only the prices inside a band. */
function clipFrame(frame: LiquidityFrame, band: ClipBand): LiquidityFrame {
    const { lowest, highest, priceBucketSize } = band;
    const held = new Map<number, number>();
    for (const ladder of [frame.bids, frame.asks]) {
        for (let index = 0; index < ladder.quantities.length; index += 1) {
            const quantity = ladder.quantities[index] ?? 0;
            const bucketIndex = ladder.lowestBucketIndex + index;
            if (quantity > 0 && bucketIndex >= lowest && bucketIndex <= highest) {
                held.set(bucketIndex, quantity);
            }
        }
    }
    return {
        capturedAtMs: frame.capturedAtMs,
        bestBidPrice: frame.bestBidPrice,
        bestAskPrice: frame.bestAskPrice,
        ...toLadders(held, Math.floor(frame.bestBidPrice / priceBucketSize)),
    };
}
