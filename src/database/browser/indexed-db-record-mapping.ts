import type { LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';

/**
 * A frame as the browser stores it.
 *
 * The ladders are kept as `Float32Array`, which structured clone carries
 * natively. That is this engine's one real advantage over the SQL one: there is
 * no encode on write and no parse on read, where `real[]` costs both.
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

export function toLiquidityFrame(record: FrameRecord): LiquidityFrame {
    return {
        capturedAtMs: record.capturedAtMs,
        bestBidPrice: record.bestBidPrice,
        bestAskPrice: record.bestAskPrice,
        bids: { lowestBucketIndex: record.bidLowestBucketIndex, quantities: record.bidQuantities },
        asks: { lowestBucketIndex: record.askLowestBucketIndex, quantities: record.askQuantities },
    };
}

export function toTradeClusterRecord(
    instrumentSymbol: string,
    priceBucketSize: number,
    cluster: TradeCluster,
): TradeClusterRecord {
    return { instrumentSymbol, priceBucketSize, ...cluster };
}

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

export function toRecordingGap(record: GapRecord): RecordingGap {
    return {
        gapStartedAtMs: record.gapStartedAtMs,
        gapEndedAtMs: record.gapEndedAtMs,
        gapReason: record.gapReason,
    };
}
