/**
 * Aggressive executions that landed in one time and price cell.
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
