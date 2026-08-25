/**
 * Aggressive executions that landed in one time and price cell.
 *
 * Every field rolls up to a coarser grid without loss: quantities and count sum,
 * and `largestTradeQuantity` maxes, so one outsized print stays legible after
 * aggregation instead of dissolving into its neighbours.
 */
export interface TradeCluster {
    readonly executedAtMs: number;
    readonly priceBucketIndex: number;
    readonly buyQuantity: number;
    readonly sellQuantity: number;
    readonly tradeCount: number;
    readonly largestTradeQuantity: number;
}

/** A run of trade clusters sharing one price grid. */
export interface TradeClusterWindow {
    readonly priceBucketSize: number;
    readonly sampleIntervalMs: number;
    readonly clusters: readonly TradeCluster[];
}
