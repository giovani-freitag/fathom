import type { SerializedPriceLevel } from '../core/depth-types.ts';

/**
 * Shapes the venue publishes, named as the venue names them.
 */
export interface BinanceDepthUpdatePayload {
    readonly e: 'depthUpdate';
    readonly E: number;
    readonly T: number;
    readonly s: string;
    readonly U: number;
    readonly u: number;
    readonly pu: number;
    readonly b: readonly SerializedPriceLevel[];
    readonly a: readonly SerializedPriceLevel[];
}

/**
 * One printed execution.
 */
export interface BinanceTradePayload {
    readonly e: 'trade';
    readonly s: string;
    readonly p: string;
    readonly q: string;
    readonly T: number;
    /** True when the resting side was the buyer, which means the aggressor sold. */
    readonly m: boolean;
}

export interface BinanceDepthLadderPayload {
    readonly lastUpdateId: number;
    readonly bids: readonly SerializedPriceLevel[];
    readonly asks: readonly SerializedPriceLevel[];
}

/** Any payload the collector subscribes to. */
export type BinanceStreamPayload = BinanceDepthUpdatePayload | BinanceTradePayload;
