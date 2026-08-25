import type { HeatmapSource } from '../../shared/core/heatmap-source.ts';
import type { LiveFeed, LiveFeedStatus, LiveFeedSubscription } from './live-feed.ts';

/** How often the page looks for seconds the collector has just filed. */
const POLL_INTERVAL_MS = 500;

/** Frames a single poll will carry, so a long stall cannot arrive as one flood. */
const MAXIMUM_FRAMES_PER_POLL = 120;

export interface ArchiveLiveFeedServiceConfig {
    readonly source: HeatmapSource;
}

/**
 * The tail when the archive is in this very page.
 */
export class ArchiveLiveFeedService implements LiveFeed {
    private readonly source: HeatmapSource;
    private subscription: LiveFeedSubscription | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private newestFrameMs = 0;
    private isPolling = false;

    constructor(config: ArchiveLiveFeedServiceConfig) {
        this.source = config.source;
        this.handlePollDue = this.handlePollDue.bind(this);
    }

    /**
     * Begins following the archive for one instrument.
     *
     * @param subscription - Where to resume from, and what to call as it advances.
     */
    connect(subscription: LiveFeedSubscription): void {
        this.disconnect();
        this.subscription = subscription;
        this.newestFrameMs = subscription.afterMs;
        this.announce('connecting');
        this.pollTimer = setInterval(this.handlePollDue, POLL_INTERVAL_MS);
    }

    /**
     * Stops following. Safe to call in any state.
     */
    disconnect(): void {
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.subscription = null;
    }

    private handlePollDue(): void {
        void this.poll();
    }

    /**
     * Reads whatever was filed since the last poll.
     */
    private async poll(): Promise<void> {
        const subscription = this.subscription;
        if (subscription === null || this.isPolling) {
            return;
        }
        this.isPolling = true;

        try {
            const toMs = Date.now() + POLL_INTERVAL_MS;
            const window = await this.source.fetchFrameWindow({
                symbol: subscription.instrumentSymbol,
                fromMs: this.newestFrameMs + 1,
                toMs,
                maxColumns: MAXIMUM_FRAMES_PER_POLL,
            });

            if (window.frames.length > 0) {
                this.newestFrameMs = window.frames[window.frames.length - 1]!.capturedAtMs;
                subscription.onFrames(window);
            }
            this.announce('streaming');
        } catch {
            this.announce('reconnecting');
        } finally {
            this.isPolling = false;
        }
    }

    private announce(status: LiveFeedStatus): void {
        this.subscription?.onStatusChanged(status);
    }
}
