/**
 * Resting size on one side of the book, as a dense run of adjacent price buckets.
 *
 * `quantities[i]` rests at bucket `lowestBucketIndex + i`. Each side carries its
 * own offset so neither stores the other side's empty half.
 */
export interface DepthLadder {
    readonly lowestBucketIndex: number;
    readonly quantities: Float32Array;
}

/** The whole visible depth ladder at one instant. */
export interface LiquidityFrame {
    readonly capturedAtMs: number;
    readonly bestBidPrice: number;
    readonly bestAskPrice: number;
    readonly bids: DepthLadder;
    readonly asks: DepthLadder;
}

/** A run of frames sharing one price grid, as returned by a heatmap query. */
export interface LiquidityFrameWindow {
    readonly priceBucketSize: number;
    /** Spacing the server actually sampled at, which is coarser than the stored grid on wide ranges. */
    readonly sampleIntervalMs: number;
    readonly frames: readonly LiquidityFrame[];
}
