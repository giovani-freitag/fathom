import { floorToInterval, toPriceBucketIndex } from '../book/price-bucket.ts';
import { type TradeCluster } from './trade-cluster.ts';
import type { ExecutedTrade } from '../book/depth-types.ts';

export interface TradeClusterAccumulatorConfig {
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
}

interface MutableCluster {
    buyQuantity: number;
    sellQuantity: number;
    tradeCount: number;
    largestTradeQuantity: number;
}

/**
 * Bins raw executions onto the frame grid as they arrive.
 *
 * A liquid perpetual prints far faster than any zoom level of the heatmap can
 * resolve, so storing prints individually would cost two orders of magnitude
 * more rows than the picture can use.
 */
export class TradeClusterAccumulator {
    private readonly config: TradeClusterAccumulatorConfig;
    private readonly clustersByFrameStart = new Map<number, Map<number, MutableCluster>>();

    constructor(config: TradeClusterAccumulatorConfig) {
        this.config = config;
    }

    /**
     * Folds one execution into its time and price cell.
     *
     * @param trade - The execution, with the venue's own timestamp.
     */
    add(trade: ExecutedTrade): void {
        const frameStartMs = floorToInterval(trade.executedAtMs, this.config.frameIntervalMs);
        const priceBucketIndex = toPriceBucketIndex(trade.price, this.config.priceBucketSize);
        const cluster = this.resolveCluster(frameStartMs, priceBucketIndex);

        if (trade.isAggressorSelling) {
            cluster.sellQuantity += trade.quantity;
        } else {
            cluster.buyQuantity += trade.quantity;
        }
        cluster.tradeCount += 1;
        cluster.largestTradeQuantity = Math.max(cluster.largestTradeQuantity, trade.quantity);
    }

    /**
     * Removes and returns every cell whose frame has already closed.
     *
     * @param frameStartMs - Start of the frame still open; cells at or after it are kept.
     * @returns Closed clusters, ordered by time then price.
     */
    drainBefore(frameStartMs: number): TradeCluster[] {
        const drained: TradeCluster[] = [];

        for (const [cellFrameStartMs, clustersByBucket] of this.clustersByFrameStart) {
            if (cellFrameStartMs >= frameStartMs) {
                continue;
            }
            for (const [priceBucketIndex, cluster] of clustersByBucket) {
                drained.push({
                    executedAtMs: cellFrameStartMs,
                    priceBucketIndex,
                    buyQuantity: cluster.buyQuantity,
                    sellQuantity: cluster.sellQuantity,
                    tradeCount: cluster.tradeCount,
                    largestTradeQuantity: cluster.largestTradeQuantity,
                });
            }
            this.clustersByFrameStart.delete(cellFrameStartMs);
        }

        drained.sort(compareClusters);
        return drained;
    }

    get pendingCellCount(): number {
        let total = 0;
        for (const clustersByBucket of this.clustersByFrameStart.values()) {
            total += clustersByBucket.size;
        }
        return total;
    }

    private resolveCluster(frameStartMs: number, priceBucketIndex: number): MutableCluster {
        let clustersByBucket = this.clustersByFrameStart.get(frameStartMs);
        if (clustersByBucket === undefined) {
            clustersByBucket = new Map<number, MutableCluster>();
            this.clustersByFrameStart.set(frameStartMs, clustersByBucket);
        }

        let cluster = clustersByBucket.get(priceBucketIndex);
        if (cluster === undefined) {
            cluster = { buyQuantity: 0, sellQuantity: 0, tradeCount: 0, largestTradeQuantity: 0 };
            clustersByBucket.set(priceBucketIndex, cluster);
        }
        return cluster;
    }
}

function compareClusters(left: TradeCluster, right: TradeCluster): number {
    return left.executedAtMs - right.executedAtMs || left.priceBucketIndex - right.priceBucketIndex;
}
