import type { LiquidityFrameWindow, LiveTextMessage } from '@fathom/contracts';
import type { LiquidityQueryService } from '@fathom/persistence';

export type Unsubscribe = () => void;

export interface LiveTailSubscriptionRequest {
    readonly instrumentSymbol: string;
    /** Newest frame the client already holds; the tail resumes after it. */
    readonly afterMs: number;
    readonly onFrames: (window: LiquidityFrameWindow) => void;
    readonly onText: (message: LiveTextMessage) => void;
}

export interface LiveTailServiceConfig {
    readonly query: LiquidityQueryService;
    readonly pollIntervalMs: number;
    readonly maxFramesPerPoll: number;
}

/**
 * Streams newly recorded history to connected viewers.
 *
 * Tails the archive rather than the collector, so a viewer sees exactly what was
 * persisted. Live and historical rendering then share one code path, and a frame
 * can never appear on screen without existing in storage.
 */
export class LiveTailService {
    private readonly config: LiveTailServiceConfig;
    private readonly subscriptions = new Set<LiveTailSubscription>();

    constructor(config: LiveTailServiceConfig) {
        this.config = config;
    }

    /**
     * Starts tailing for one viewer.
     *
     * @param request - Instrument, resume point, and the two delivery callbacks.
     * @returns A canceller; calling it twice is safe.
     */
    subscribe(request: LiveTailSubscriptionRequest): Unsubscribe {
        const subscription = new LiveTailSubscription(request, this.config);
        this.subscriptions.add(subscription);
        subscription.start();

        return () => {
            subscription.stop();
            this.subscriptions.delete(subscription);
        };
    }

    /**
     * Stops every tail, for shutdown.
     */
    stop(): void {
        for (const subscription of this.subscriptions) {
            subscription.stop();
        }
        this.subscriptions.clear();
    }

    get subscriptionCount(): number {
        return this.subscriptions.size;
    }
}

/**
 * One viewer's tail.
 *
 * Each subscription polls on its own cursor rather than sharing a per-instrument
 * one, so a viewer that connects mid-session resumes exactly where its history
 * request ended instead of skipping whatever landed in between.
 */
class LiveTailSubscription {
    private readonly request: LiveTailSubscriptionRequest;
    private readonly config: LiveTailServiceConfig;

    private frameCursorMs: number;
    private tradeCursorMs: number;
    private pollTimer: NodeJS.Timeout | null = null;
    private isPolling = false;
    private wasStopped = false;

    constructor(request: LiveTailSubscriptionRequest, config: LiveTailServiceConfig) {
        this.request = request;
        this.config = config;
        this.frameCursorMs = request.afterMs;
        this.tradeCursorMs = request.afterMs;
        this.handlePollDue = this.handlePollDue.bind(this);
    }

    start(): void {
        this.pollTimer = setInterval(this.handlePollDue, this.config.pollIntervalMs);
        this.pollTimer.unref();
        this.handlePollDue();
    }

    stop(): void {
        this.wasStopped = true;
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private handlePollDue(): void {
        void this.poll();
    }

    private async poll(): Promise<void> {
        if (this.isPolling || this.wasStopped) {
            return;
        }
        this.isPolling = true;
        try {
            await this.pushFrames();
            await this.pushTradeClusters();
        } catch {
            // A transient archive failure is not worth closing the socket over;
            // the cursors did not advance, so the next tick retries the same range.
        } finally {
            this.isPolling = false;
        }
    }

    private async pushFrames(): Promise<void> {
        const window = await this.config.query.fetchFramesAfter({
            symbol: this.request.instrumentSymbol,
            afterMs: this.frameCursorMs,
            maxFrames: this.config.maxFramesPerPoll,
        });

        const newestFrame = window.frames[window.frames.length - 1];
        if (newestFrame === undefined || this.wasStopped) {
            return;
        }

        this.frameCursorMs = newestFrame.capturedAtMs;
        this.request.onFrames(window);
    }

    private async pushTradeClusters(): Promise<void> {
        const untilMs = this.frameCursorMs;
        if (untilMs <= this.tradeCursorMs) {
            return;
        }

        const window = await this.config.query.fetchTradeClusters({
            symbol: this.request.instrumentSymbol,
            fromMs: this.tradeCursorMs,
            toMs: untilMs + 1,
            maxColumns: this.config.maxFramesPerPoll,
            priceGroupSize: 1,
            minimumQuantity: 0,
            maxClusters: 5_000,
        });

        this.tradeCursorMs = untilMs;
        if (window.clusters.length > 0 && !this.wasStopped) {
            this.request.onText({ kind: 'trade-clusters', clusters: window.clusters });
        }
    }
}
