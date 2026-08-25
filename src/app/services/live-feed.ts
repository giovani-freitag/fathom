import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import type { LiveTextMessage } from '../../shared/core/api-contract.ts';

export type LiveFeedStatus = 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'refused';

export interface LiveFeedSubscription {
    readonly instrumentSymbol: string;
    /** Newest frame already held; the tail resumes strictly after it. */
    readonly afterMs: number;
    readonly onFrames: (window: LiquidityFrameWindow) => void;
    readonly onText: (message: LiveTextMessage) => void;
    readonly onStatusChanged: (status: LiveFeedStatus) => void;
}

/**
 * How the chart learns about a second that was just recorded.
 */
export interface LiveFeed {
    connect(subscription: LiveFeedSubscription): void;
    disconnect(): void;
}
