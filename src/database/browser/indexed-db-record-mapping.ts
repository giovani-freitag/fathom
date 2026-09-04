import type { LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';

/**
 * A frame as the browser stores it.
 */
export interface FrameRecord {
    readonly instrumentSymbol: string;
    readonly capturedAtMs: number;
    readonly priceBucketSize: number;
    readonly bestBidPrice: number;
    readonly bestAskPrice: number;
    readonly bidLowestBucketIndex: number;
    readonly bidQuantities: Float32Array;
    readonly askLowestBucketIndex: number;
    readonly askQuantities: Float32Array;
}

export interface TradeClusterRecord {
    readonly instrumentSymbol: string;
    readonly executedAtMs: number;
    readonly priceBucketSize: number;
    readonly priceBucketIndex: number;
    readonly buyQuantity: number;
    readonly sellQuantity: number;
    readonly tradeCount: number;
    readonly largestTradeQuantity: number;
}

export interface GapRecord {
    readonly instrumentSymbol: string;
    readonly gapStartedAtMs: number;
    readonly gapEndedAtMs: number;
    readonly gapReason: string;
}

export interface InstrumentRecord {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
    readonly registeredAtMs: number;
}

/**
 * A frame as the store keys it.
 *
 * The instrument and the bucket size are carried on the row rather than in the
 * frame: the store holds every instrument in one place, and a row that cannot
 * say which one it belongs to cannot be read back.
 *
 * @param instrumentSymbol - Which market the frame was recorded from.
 * @param priceBucketSize - The ladder step the quantities are counted on.
 * @param frame - The frame itself.
 * @returns The row to write.
 */
export function toFrameRecord(
    instrumentSymbol: string,
    priceBucketSize: number,
    frame: LiquidityFrame,
): FrameRecord {
    return {
        instrumentSymbol,
        capturedAtMs: frame.capturedAtMs,
        priceBucketSize,
        bestBidPrice: frame.bestBidPrice,
        bestAskPrice: frame.bestAskPrice,
        bidLowestBucketIndex: frame.bids.lowestBucketIndex,
        bidQuantities: frame.bids.quantities,
        askLowestBucketIndex: frame.asks.lowestBucketIndex,
        askQuantities: frame.asks.quantities,
    };
}

/**
 * A frame back out of the row it was written as.
 *
 * @param record - The row, as the store returned it.
 * @returns The frame.
 */
export function toLiquidityFrame(record: FrameRecord): LiquidityFrame {
    return {
        capturedAtMs: record.capturedAtMs,
        bestBidPrice: record.bestBidPrice,
        bestAskPrice: record.bestAskPrice,
        bids: { lowestBucketIndex: record.bidLowestBucketIndex, quantities: record.bidQuantities },
        asks: { lowestBucketIndex: record.askLowestBucketIndex, quantities: record.askQuantities },
    };
}

/**
 * An execution bucket as the store keys it.
 *
 * @param instrumentSymbol - Which market it was recorded from.
 * @param priceBucketSize - The ladder step its price index counts in.
 * @param cluster - The bucket itself.
 * @returns The row to write.
 */
export function toTradeClusterRecord(
    instrumentSymbol: string,
    priceBucketSize: number,
    cluster: TradeCluster,
): TradeClusterRecord {
    return { instrumentSymbol, priceBucketSize, ...cluster };
}

/**
 * An execution bucket back out of its row.
 *
 * @param record - The row, as the store returned it.
 * @returns The bucket.
 */
export function toTradeCluster(record: TradeClusterRecord): TradeCluster {
    return {
        executedAtMs: record.executedAtMs,
        priceBucketIndex: record.priceBucketIndex,
        buyQuantity: record.buyQuantity,
        sellQuantity: record.sellQuantity,
        tradeCount: record.tradeCount,
        largestTradeQuantity: record.largestTradeQuantity,
    };
}

/**
 * A stretch nothing was recorded through, back out of its row.
 *
 * @param record - The row, as the store returned it.
 * @returns The gap.
 */
export function toRecordingGap(record: GapRecord): RecordingGap {
    return {
        gapStartedAtMs: record.gapStartedAtMs,
        gapEndedAtMs: record.gapEndedAtMs,
        gapReason: record.gapReason,
    };
}
