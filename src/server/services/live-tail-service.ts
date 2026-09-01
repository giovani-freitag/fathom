import { LiveTail, type LiveTailSource } from '../../shared/core/live-tail.ts';
import type { LiveMessage } from '../../shared/core/live-message.ts';

export type Unsubscribe = () => void;

export interface LiveTailSubscriptionRequest {
    readonly instrumentSymbol: string;
    /** Newest frame the client already holds; the tail resumes after it. */
    readonly afterMs: number;
    readonly priceBucketSize: number;
    readonly onMessage: (message: LiveMessage) => void;
    /**
     * Which store the reader is drawing, or absent for the frame table.
     *
     * A tail has to stream what the window it is extending holds. Reading the
     * band around the price into a chart drawn from the whole book leaves
     * everything outside that band standing still.
     */
    readonly source?: string;
    /** The prices the reader is drawing, so the tail carries only those. */
    readonly lowPrice?: number;
    readonly highPrice?: number;
    /** What one instant of the recording covers, so no read is folded. */
    readonly frameIntervalMs?: number;
}

export interface LiveTailServiceConfig {
    readonly source: LiveTailSource;
    /** The stores a reader may name, beside the frame table the default reads. */
    readonly sourcesByName?: Readonly<Record<string, LiveTailSource>>;
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

/** Raised when a reader names a store this gateway was not wired with. */
export class UnknownTailSourceError extends Error {
    constructor(name: string) {
        super(`The gateway has no live tail for ${name}`);
        this.name = 'UnknownTailSourceError';
    }
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
            source: this.resolveSource(request.source),
            instrumentSymbol: request.instrumentSymbol,
            afterMs: request.afterMs,
            maxFramesPerPoll: this.config.maxFramesPerPoll,
            deliver: request.onMessage,
            ...(request.lowPrice === undefined ? {} : { lowPrice: request.lowPrice }),
            ...(request.highPrice === undefined ? {} : { highPrice: request.highPrice }),
            ...(request.frameIntervalMs === undefined
                ? {}
                : { frameIntervalMs: request.frameIntervalMs }),
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

    /**
     * The store a named reader is streamed from.
     *
     * A name with nothing behind it is refused rather than quietly served from
     * somewhere else. These stores exist to be weighed against each other, and a
     * chart fed from a store the reader did not choose is a measurement of
     * nothing — which is far worse, and far harder to notice, than a socket that
     * closes and says why.
     *
     * @throws UnknownTailSourceError when the name was never wired up.
     */
    private resolveSource(name: string | undefined): LiveTailSource {
        if (name === undefined) {
            return this.config.source;
        }
        const named = this.config.sourcesByName?.[name];
        if (named === undefined) {
            throw new UnknownTailSourceError(name);
        }
        return named;
    }

    private release(entry: RunningTail): void {
        entry.tail.stop();
        clearInterval(entry.timer);
        this.running.delete(entry);
    }
}
