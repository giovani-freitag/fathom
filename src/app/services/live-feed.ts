import type { LiveMessage } from '../../shared/core/live-message.ts';

export type LiveFeedStatus = 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'refused';

export interface LiveFeedSubscription {
    readonly instrumentSymbol: string;
    /** Newest frame already held; the tail resumes strictly after it. */
    readonly afterMs: number;
    /**
     * Which store the chart is drawing.
     *
     * A tail extends the window the history route answered, so it has to stream
     * out of the same store: the frame table holds a band around the price, and
     * streaming it into a chart drawn from the whole book freezes everything
     * outside that band.
     */
    readonly source?: string;
    /**
     * The prices on screen, so the tail carries only those.
     *
     * A whole-book store holds some fifteen thousand prices where a chart draws
     * sixty. Prices without a row budget: folded to a budget the tail would
     * answer on a grid of its own, and a grid the window it extends does not
     * divide into cannot be laid on it at all.
     */
    readonly priceBand?: { readonly lowPrice: number; readonly highPrice: number };
    /** Every driver delivers the same type, whatever carried it. */
    readonly onMessage: (message: LiveMessage) => void;
    readonly onStatusChanged: (status: LiveFeedStatus) => void;
}

/**
 * How the chart learns about a second that was just recorded.
 */
export interface LiveFeed {
    connect(subscription: LiveFeedSubscription): void;
    disconnect(): void;
}
