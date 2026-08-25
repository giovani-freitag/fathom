import type { DepthLadder, LiquidityFrame } from '../../shared/core/liquidity-frame.ts';

/**
 * How many instants are read and folded into each output column.
 *
 * A single instant per column keeps every quote that happened to exist at that
 * moment, which on a wide window is mostly quotes that lived for less time than
 * the column is wide. Folding a handful of instants fades those in proportion to
 * how long they actually rested, while a wall that never moved keeps its size.
 */
export const INSTANTS_PER_COLUMN = 4;

/**
 * Folds evenly spaced instants into one frame per column.
 *
 * @param frames - Frames ordered by capture time, sampled finer than the grid.
 * @param columnIntervalMs - Width of one output column.
 * @returns One averaged frame per column that had any, oldest first.
 */
export function foldFramesIntoColumns(
    frames: readonly LiquidityFrame[],
    columnIntervalMs: number,
): LiquidityFrame[] {
    if (columnIntervalMs <= 0) {
        return [...frames];
    }

    const folded: LiquidityFrame[] = [];
    let group: LiquidityFrame[] = [];
    let groupStartMs: number | null = null;

    for (const frame of frames) {
        const columnStartMs = Math.floor(frame.capturedAtMs / columnIntervalMs) * columnIntervalMs;
        if (groupStartMs !== columnStartMs) {
            if (group.length > 0) {
                folded.push(averageFrames(group, groupStartMs!));
            }
            group = [];
            groupStartMs = columnStartMs;
        }
        group.push(frame);
    }

    if (group.length > 0) {
        folded.push(averageFrames(group, groupStartMs!));
    }
    return folded;
}

/**
 * Averages a group of frames into one.
 *
 * @param group - Frames belonging to a single column, at least one.
 * @param capturedAtMs - Instant the folded frame is filed under.
 * @returns The averaged frame.
 */
function averageFrames(group: readonly LiquidityFrame[], capturedAtMs: number): LiquidityFrame {
    const first = group[0]!;
    if (group.length === 1) {
        return { ...first, capturedAtMs };
    }

    let bidPriceTotal = 0;
    let askPriceTotal = 0;
    for (const frame of group) {
        bidPriceTotal += frame.bestBidPrice;
        askPriceTotal += frame.bestAskPrice;
    }

    return {
        capturedAtMs,
        bestBidPrice: bidPriceTotal / group.length,
        bestAskPrice: askPriceTotal / group.length,
        bids: averageLadders(group.map((frame) => frame.bids)),
        asks: averageLadders(group.map((frame) => frame.asks)),
    };
}

/**
 * Averages ladders that may sit on different stretches of the same grid.
 *
 * Each frame records only the band around its own mid price, so two instants a
 * minute apart start at different buckets. They are aligned by absolute bucket
 * index, and a bucket missing from one instant counts as the zero it was.
 */
function averageLadders(ladders: readonly DepthLadder[]): DepthLadder {
    let lowestBucketIndex = Number.POSITIVE_INFINITY;
    let highestBucketIndex = Number.NEGATIVE_INFINITY;

    for (const ladder of ladders) {
        if (ladder.quantities.length === 0) {
            continue;
        }
        lowestBucketIndex = Math.min(lowestBucketIndex, ladder.lowestBucketIndex);
        highestBucketIndex = Math.max(
            highestBucketIndex,
            ladder.lowestBucketIndex + ladder.quantities.length - 1,
        );
    }

    if (!Number.isFinite(lowestBucketIndex)) {
        return { lowestBucketIndex: 0, quantities: new Float32Array(0) };
    }

    const quantities = new Float32Array(highestBucketIndex - lowestBucketIndex + 1);
    for (const ladder of ladders) {
        for (let offset = 0; offset < ladder.quantities.length; offset += 1) {
            const target = ladder.lowestBucketIndex + offset - lowestBucketIndex;
            quantities[target] = quantities[target]! + ladder.quantities[offset]!;
        }
    }
    for (let index = 0; index < quantities.length; index += 1) {
        quantities[index] = quantities[index]! / ladders.length;
    }

    return { lowestBucketIndex, quantities };
}
