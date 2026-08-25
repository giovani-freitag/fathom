import type { LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';
import type { ChartDataset } from './chart-dataset.ts';

/**
 * Frame closest in time to an instant.
 *
 * Frames arrive in capture order, so the search is a bisection: a wide window
 * holds thousands and this runs on every pointer move.
 *
 * @param frames - Frames in ascending capture order.
 * @param timestampMs - The instant to look up.
 * @returns The nearest frame, or undefined when there are none.
 */
export function findFrameNearest(
    frames: readonly LiquidityFrame[],
    timestampMs: number,
): LiquidityFrame | undefined {
    if (frames.length === 0) {
        return undefined;
    }

    let low = 0;
    let high = frames.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (frames[middle]!.capturedAtMs < timestampMs) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    const candidate = frames[low]!;
    const previous = frames[low - 1];
    if (previous === undefined) {
        return candidate;
    }
    return Math.abs(previous.capturedAtMs - timestampMs) < Math.abs(candidate.capturedAtMs - timestampMs)
        ? previous
        : candidate;
}

/**
 * Executions in the cell containing a price and an instant.
 *
 * Executions sit on their own, coarser grid than the frames, and a bubble is
 * drawn at the start of its bin; measuring against the frame interval would miss
 * every bin wider than a second.
 *
 * @param dataset - The loaded window.
 * @param price - Price to look up, in quote currency.
 * @param timestampMs - The instant to look up.
 * @returns The nearest matching cluster, or null when nothing traded there.
 */
export function findClusterAt(
    dataset: ChartDataset,
    price: number,
    timestampMs: number,
): TradeCluster | null {
    const { clusters, clusterPriceBucketSize, clusterIntervalMs } = dataset;
    if (clusters.length === 0) {
        return null;
    }

    const wantedBucket = Math.floor(price / clusterPriceBucketSize);
    const tolerance = Math.max(clusterIntervalMs, 1_000);

    let low = 0;
    let high = clusters.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (clusters[middle]!.executedAtMs < timestampMs - tolerance) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    let nearest: TradeCluster | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = low; index < clusters.length; index += 1) {
        const cluster = clusters[index]!;
        if (cluster.executedAtMs > timestampMs + tolerance) {
            break;
        }
        const distance = Math.abs(cluster.executedAtMs - timestampMs);
        if (cluster.priceBucketIndex === wantedBucket && distance < nearestDistance) {
            nearest = cluster;
            nearestDistance = distance;
        }
    }
    return nearest;
}
