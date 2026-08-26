import { LiveTail, type LiveTailSource } from '../../shared/core/live-tail.ts';
import type { LiveMessage } from '../../shared/core/live-message.ts';

export type Unsubscribe = () => void;

export interface LiveTailSubscriptionRequest {
    readonly instrumentSymbol: string;
    /** Newest frame the client already holds; the tail resumes after it. */
    readonly afterMs: number;
    readonly priceBucketSize: number;
    readonly onMessage: (message: LiveMessage) => void;
}

export interface LiveTailServiceConfig {
    readonly source: LiveTailSource;
    /**
     * How often a tail catches up on its own.
     *
     * A backstop rather than the clock: the archive nudges the gateway when it
     * writes, and this is what closes the window if a notification is missed.
     */
    readonly pollIntervalMs: number;
    readonly maxFramesPerPoll: number;
    readonly maximumSubscriptions: number;
}

/** Raised when the gateway is already tailing for as many viewers as it will. */
export class TooManySubscribersError extends Error {
    constructor(maximumSubscriptions: number) {
        super(`The gateway is already serving ${maximumSubscriptions} live tails`);
        this.name = 'TooManySubscribersError';
    }
}

interface RunningTail {
    readonly instrumentSymbol: string;
    readonly tail: LiveTail;
    readonly timer: NodeJS.Timeout;
}

/**
 * Streams newly recorded history to connected viewers.
 */
export class LiveTailService {
    private readonly config: LiveTailServiceConfig;
    private readonly running = new Set<RunningTail>();

    constructor(config: LiveTailServiceConfig) {
        this.config = config;
    }

    /**
     * Starts tailing for one viewer.
     *
     * @param request - Instrument, resume point, and where messages go.
     * @returns A canceller; calling it twice is safe.
     * @throws TooManySubscribersError when the tail budget is already spent.
     */
    subscribe(request: LiveTailSubscriptionRequest): Unsubscribe {
        if (this.running.size >= this.config.maximumSubscriptions) {
            throw new TooManySubscribersError(this.config.maximumSubscriptions);
        }

        const tail = new LiveTail({
            source: this.config.source,
            instrumentSymbol: request.instrumentSymbol,
            afterMs: request.afterMs,
            maxFramesPerPoll: this.config.maxFramesPerPoll,
            deliver: request.onMessage,
        });

        const timer = setInterval(() => { void tail.advance(); }, this.config.pollIntervalMs);
        timer.unref();

        const entry: RunningTail = { instrumentSymbol: request.instrumentSymbol, tail, timer };
        this.running.add(entry);

        tail.announce(request.priceBucketSize);
        void tail.advance();

        return () => { this.release(entry); };
    }

    /**
     * Catches up every tail following an instrument.
     *
     * Called when the archive says it has written something, which is what
     * turns the interval above into a backstop rather than the only trigger.
     *
     * @param instrumentSymbol - The contract that just grew.
     */
    nudge(instrumentSymbol: string): void {
        for (const entry of this.running) {
            if (entry.instrumentSymbol === instrumentSymbol) {
                void entry.tail.advance();
            }
        }
    }

    /**
     * Stops every tail, for shutdown.
     */
    stop(): void {
        for (const entry of [...this.running]) {
            this.release(entry);
        }
    }

    get subscriptionCount(): number {
        return this.running.size;
    }

    private release(entry: RunningTail): void {
        entry.tail.stop();
        clearInterval(entry.timer);
        this.running.delete(entry);
    }
}
