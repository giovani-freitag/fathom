import type { SerializedPriceLevel } from '../book/depth-types.ts';

/**
 * Shapes the venue publishes, named as the venue names them.
 *
 * These single-letter fields exist only inside this folder; the feed service
 * maps them onto the collector's own vocabulary before anything else sees them.
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
 *
 * The aggregated variant of this stream publishes nothing on USD-M futures, and
 * raw prints are the better input regardless: the largest single execution in a
 * cell stays a real trade instead of a batch the venue had already merged.
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
