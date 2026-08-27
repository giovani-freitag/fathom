import type { CollectorEvent } from '../../shared/core/collector-worker-contract.ts';
import type { LiveFeed, LiveFeedSubscription } from './live-feed.ts';

export interface WorkerLiveFeedServiceConfig {
    /** Asks the collector beside this page to follow a contract. */
    readonly subscribe: (instrumentSymbol: string, afterMs: number) => void;
    readonly unsubscribe: () => void;
}

/**
 * The tail when the collector is a worker in this very page.
 *
 * The mirror of the socket driver: the gateway's tail reaches the chart over a
 * wire, this one over `postMessage`, and both hand it the same message.
 */
export class WorkerLiveFeedService implements LiveFeed {
    private readonly config: WorkerLiveFeedServiceConfig;
    private subscription: LiveFeedSubscription | null = null;
    private isAcknowledged = false;

    constructor(config: WorkerLiveFeedServiceConfig) {
        this.config = config;
        this.handleCollectorEvent = this.handleCollectorEvent.bind(this);
    }

    /**
     * Begins following one instrument.
     *
     * @param subscription - Where to resume from, and what to call as it advances.
     */
    connect(subscription: LiveFeedSubscription): void {
        this.subscription = subscription;
        this.isAcknowledged = false;
        subscription.onStatusChanged('connecting');
        this.config.subscribe(subscription.instrumentSymbol, subscription.afterMs);
    }

    /**
     * Stops following. Safe to call in any state.
     */
    disconnect(): void {
        const subscription = this.subscription;
        this.subscription = null;
        this.isAcknowledged = false;
        if (subscription === null) {
            return;
        }
        this.config.unsubscribe();
        subscription.onStatusChanged('idle');
    }

    /**
     * Takes one event from the collector, forwarding what the chart cares about.
     *
     * @param event - Anything the worker said, live messages included.
     */
    handleCollectorEvent(event: CollectorEvent): void {
        const subscription = this.subscription;
        if (subscription === null || event.kind !== 'live') {
            return;
        }

        // The first message of a tail is its acknowledgement, which is the only
        // point at which this driver knows the collector is actually answering.
        if (event.message.kind === 'subscribed') {
            this.isAcknowledged = event.message.instrumentSymbol === subscription.instrumentSymbol;
            if (this.isAcknowledged) {
                subscription.onStatusChanged('streaming');
            }
        }

        // Anything before the acknowledgement was posted for the tail that was
        // asked to stop, and a frame message names no instrument: delivered, it
        // draws one contract's liquidity onto another contract's chart.
        if (!this.isAcknowledged) {
            return;
        }
        subscription.onMessage(event.message);
    }
}
