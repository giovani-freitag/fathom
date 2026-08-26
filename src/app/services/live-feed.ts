import type { LiveMessage } from '../../shared/core/live-message.ts';

export type LiveFeedStatus = 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'refused';

export interface LiveFeedSubscription {
    readonly instrumentSymbol: string;
    /** Newest frame already held; the tail resumes strictly after it. */
    readonly afterMs: number;
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
