/** A price level as the venue serializes it, before any numeric parsing. */
export type SerializedPriceLevel = readonly [price: string, quantity: string];

/**
 * One incremental depth update, in venue-neutral terms.
 *
 * `previousFinalUpdateId` is what makes a dropped message detectable: it must
 * equal the `finalUpdateId` of the update that came before, so a break in the
 * chain is an unambiguous signal rather than a silent corruption.
 */
export interface DepthDiff {
    readonly firstUpdateId: number;
    readonly finalUpdateId: number;
    readonly previousFinalUpdateId: number;
    readonly bidLevels: readonly SerializedPriceLevel[];
    readonly askLevels: readonly SerializedPriceLevel[];
}

/** A full depth ladder captured at one point in the venue's update sequence. */
export interface DepthSnapshot {
    readonly lastUpdateId: number;
    readonly bidLevels: readonly SerializedPriceLevel[];
    readonly askLevels: readonly SerializedPriceLevel[];
}

/** One aggressive execution, in venue-neutral terms. */
export interface ExecutedTrade {
    readonly executedAtMs: number;
    readonly price: number;
    readonly quantity: number;
    readonly isAggressorSelling: boolean;
}

/** The two prices that separate resting bids from resting asks. */
export interface TopOfBook {
    readonly bestBidPrice: number;
    readonly bestAskPrice: number;
}

/** A consistent read of the local book. */
export interface OrderBookReading extends TopOfBook {
    readonly bidQuantityByPrice: ReadonlyMap<number, number>;
    readonly askQuantityByPrice: ReadonlyMap<number, number>;
}
