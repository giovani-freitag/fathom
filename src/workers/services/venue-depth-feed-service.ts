import { releaseTimerFromEventLoop, type TimerHandle } from '../../shared/core/timers.ts';
import { describeError } from '../core/collector-log.ts';
import type { DepthDiff, DepthSnapshot, ExecutedTrade } from '../../shared/core/depth-types.ts';
import type { MarketDataSocket, MarketDataSocketFactory } from '../core/market-data-socket.ts';
import type { VenueConnector, VenueStreamPlan } from '../../shared/core/venue-connector.ts';

export interface VenueDepthFeedServiceConfig {
    readonly instrumentSymbol: string;
    /** What the venue can do, and how to read what it says. */
    readonly connector: VenueConnector;
    readonly proactiveReconnectIntervalMs: number;
    readonly inboundSilenceTimeoutMs: number;
    readonly initialReconnectDelayMs: number;
    readonly maximumReconnectDelayMs: number;
    readonly snapshotRequestTimeoutMs: number;
    readonly onDepthDiff: (diff: DepthDiff) => void;
    readonly onExecutedTrade: (trade: ExecutedTrade) => void;
    readonly onConnected: () => void;
    readonly onDisconnected: (reason: string) => void;
    /** Opens one socket per connection attempt, in whatever runtime this is. */
    readonly openSocket: MarketDataSocketFactory;
}

/** Raised when the venue's REST endpoint will not serve a depth ladder. */
export class DepthLadderUnavailableError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'DepthLadderUnavailableError';
    }
}

/**
 * One venue's live feed, kept open.
 *
 * Everything here is about staying connected: the backoff, the silence
 * watchdog, the reconnect ahead of the venue's own cutoff. What the venue says
 * and where it says it comes from the connector, so a venue this build has
 * never seen needs no change to any of it.
 */
export class VenueDepthFeedService {
    private readonly config: VenueDepthFeedServiceConfig;
    private readonly plan: VenueStreamPlan;
    private heartbeatTimer: TimerHandle | null = null;

    private activeSocket: MarketDataSocket | null = null;
    private consecutiveFailureCount = 0;
    private wasShutdownRequested = false;
    private silenceWatchdogTimer: TimerHandle | null = null;
    private proactiveReconnectTimer: TimerHandle | null = null;
    private reconnectTimer: TimerHandle | null = null;

    constructor(config: VenueDepthFeedServiceConfig) {
        this.config = config;
        if (config.connector.planStream === null) {
            throw new Error('This venue streams nothing, so there is nothing to keep open');
        }
        this.plan = config.connector.planStream(config.instrumentSymbol);

        this.handleSocketOpen = this.handleSocketOpen.bind(this);
        this.handleSocketMessage = this.handleSocketMessage.bind(this);
        this.handleSocketError = this.handleSocketError.bind(this);
        this.handleSocketClose = this.handleSocketClose.bind(this);
        this.handleSilenceElapse = this.handleSilenceElapse.bind(this);
        this.handleProactiveReconnectDue = this.handleProactiveReconnectDue.bind(this);
        this.handleReconnectDue = this.handleReconnectDue.bind(this);
        this.handleHeartbeatDue = this.handleHeartbeatDue.bind(this);
    }

    /**
     * Opens the market data socket and keeps it open.
     */
    connect(): void {
        if (this.wasShutdownRequested) {
            throw new Error('This feed service was disconnected and cannot be reconnected');
        }
        const socket = this.config.openSocket(this.plan.url);
        this.activeSocket = socket;
        this.listen(socket);
    }

    /**
     * Closes the socket and cancels every timer it owns.
     */
    async disconnect(): Promise<void> {
        this.wasShutdownRequested = true;
        this.clearTimers();

        const socket = this.activeSocket;
        this.activeSocket = null;
        if (socket === null) {
            return;
        }

        await socket.close();
    }

    /**
     * Fetches a full depth ladder over REST.
     *
     * @returns The ladder and the update identifier it is current as of.
     * @throws DepthLadderUnavailableError when the venue rejects or times out the request.
     */
    async fetchDepthSnapshot(): Promise<DepthSnapshot> {
        const reader = this.config.connector.book;
        if (reader === null) {
            throw new DepthLadderUnavailableError('This venue publishes no book');
        }

        const request = reader.planSnapshot(this.config.instrumentSymbol);
        let response: Response;
        try {
            response = await fetch(request.url, {
                signal: AbortSignal.timeout(this.config.snapshotRequestTimeoutMs),
                ...request.headers === undefined ? {} : { headers: request.headers },
            });
        } catch (error) {
            throw new DepthLadderUnavailableError('Depth ladder request did not complete', { cause: error });
        }

        if (!response.ok) {
            throw new DepthLadderUnavailableError(`Depth ladder request returned status ${response.status}`);
        }

        let body: unknown;
        try {
            body = await response.json();
        } catch (error) {
            throw new DepthLadderUnavailableError('Depth ladder response was not JSON', { cause: error });
        }

        try {
            return reader.readSnapshot(body);
        } catch (error) {
            // The venue answers some rejections with HTTP 200 and a code/message
            // body. Read as a ladder, that yields undefined sides, and an
            // undefined side reaches the mirror as a book with nothing in it.
            throw new DepthLadderUnavailableError('Depth ladder response carried no ladder', { cause: error });
        }
    }

    private listen(socket: MarketDataSocket): void {
        socket.onOpen(this.handleSocketOpen);
        socket.onMessage(this.handleSocketMessage);
        socket.onError(this.handleSocketError);
        socket.onClose(this.handleSocketClose);
    }

    private handleSocketOpen(): void {
        this.consecutiveFailureCount = 0;
        this.restartSilenceWatchdog();
        this.scheduleProactiveReconnect();
        this.startHeartbeat();

        for (const greeting of this.plan.greetings ?? []) {
            this.activeSocket?.send(greeting);
        }
        this.config.onConnected();
    }

    /**
     * Keeps the socket alive on a venue that asks to be told it is still wanted.
     *
     * The timer is the engine's, not the connector's: a connector that owned one
     * could keep the process alive after the recording it belonged to was gone.
     */
    private startHeartbeat(): void {
        const beat = this.plan.heartbeat;
        if (beat === undefined || beat === null) {
            return;
        }
        this.heartbeatTimer = setInterval(this.handleHeartbeatDue, beat.everyMs);
        releaseTimerFromEventLoop(this.heartbeatTimer);
    }

    private handleHeartbeatDue(): void {
        const beat = this.plan.heartbeat;
        if (beat !== undefined && beat !== null) {
            this.activeSocket?.send(beat.send);
        }
    }

    private handleSocketMessage(frameText: string): void {
        this.restartSilenceWatchdog();

        let payload: unknown;
        try {
            payload = JSON.parse(frameText);
        } catch {
            return;
        }

        const update = this.config.connector.book?.readUpdate(payload) ?? null;
        if (update !== null) {
            this.config.onDepthDiff(update);
            return;
        }
        for (const trade of this.config.connector.tape?.readTrades(payload) ?? []) {
            this.config.onExecutedTrade(trade);
        }
    }

    private handleSocketError(reason: unknown): void {
        this.recycleConnection(`socket error: ${describeError(reason)}`);
    }

    private handleSocketClose(): void {
        this.recycleConnection('socket closed');
    }

    private handleSilenceElapse(): void {
        this.recycleConnection('no inbound traffic within the silence timeout');
    }

    private handleProactiveReconnectDue(): void {
        this.recycleConnection('proactive reconnect ahead of the venue cutoff');
    }

    private handleReconnectDue(): void {
        if (this.wasShutdownRequested) {
            return;
        }
        this.connect();
    }

    private recycleConnection(reason: string): void {
        const socket = this.activeSocket;
        if (socket === null) {
            return;
        }

        this.clearTimers();
        this.activeSocket = null;
        void socket.close();

        this.config.onDisconnected(reason);
        if (this.wasShutdownRequested) {
            return;
        }

        this.consecutiveFailureCount += 1;
        this.reconnectTimer = setTimeout(this.handleReconnectDue, this.resolveBackoffDelay());
        releaseTimerFromEventLoop(this.reconnectTimer);
    }

    private resolveBackoffDelay(): number {
        const exponentialDelay
            = this.config.initialReconnectDelayMs * 2 ** (this.consecutiveFailureCount - 1);
        return Math.min(exponentialDelay, this.config.maximumReconnectDelayMs);
    }

    private restartSilenceWatchdog(): void {
        if (this.silenceWatchdogTimer !== null) {
            clearTimeout(this.silenceWatchdogTimer);
        }
        this.silenceWatchdogTimer = setTimeout(this.handleSilenceElapse, this.config.inboundSilenceTimeoutMs);
        releaseTimerFromEventLoop(this.silenceWatchdogTimer);
    }

    private scheduleProactiveReconnect(): void {
        if (this.proactiveReconnectTimer !== null) {
            clearTimeout(this.proactiveReconnectTimer);
        }
        this.proactiveReconnectTimer = setTimeout(
            this.handleProactiveReconnectDue,
            this.config.proactiveReconnectIntervalMs,
        );
        releaseTimerFromEventLoop(this.proactiveReconnectTimer);
    }

    private clearTimers(): void {
        for (const timer of [this.silenceWatchdogTimer, this.proactiveReconnectTimer, this.reconnectTimer]) {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
        }
        this.silenceWatchdogTimer = null;
        this.proactiveReconnectTimer = null;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
    }
}
