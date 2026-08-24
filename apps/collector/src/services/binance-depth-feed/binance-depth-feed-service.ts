import WebSocket from 'ws';
import { delay } from '../../timing/delay.ts';
import type { DepthDiff, DepthSnapshot, ExecutedTrade } from '../order-book/depth-types.ts';
import type {
    BinanceDepthLadderPayload,
    BinanceDepthUpdatePayload,
    BinanceStreamPayload,
    BinanceTradePayload,
} from './binance-payloads.ts';

export interface BinanceDepthFeedServiceConfig {
    readonly instrumentSymbol: string;
    readonly restApiBaseUrl: string;
    readonly webSocketBaseUrl: string;
    readonly depthSnapshotLevelLimit: number;
    readonly depthUpdateIntervalLabel: string;
    readonly proactiveReconnectIntervalMs: number;
    readonly inboundSilenceTimeoutMs: number;
    readonly initialReconnectDelayMs: number;
    readonly maximumReconnectDelayMs: number;
    readonly snapshotRequestTimeoutMs: number;
    readonly onDepthDiff: (diff: DepthDiff) => void;
    readonly onExecutedTrade: (trade: ExecutedTrade) => void;
    readonly onConnected: () => void;
    readonly onDisconnected: (reason: string) => void;
}

/** Raised when the venue's REST endpoint will not serve a depth ladder. */
export class DepthLadderUnavailableError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'DepthLadderUnavailableError';
    }
}

/**
 * The only place the venue's API is spoken.
 *
 * Owns the socket's whole lifecycle — backoff, a silence watchdog, and a
 * reconnect scheduled ahead of the venue's own 24-hour cutoff — and translates
 * every payload into the collector's vocabulary on the way through.
 */
export class BinanceDepthFeedService {
    private readonly config: BinanceDepthFeedServiceConfig;
    private readonly streamUrl: string;

    private activeSocket: WebSocket | null = null;
    private consecutiveFailureCount = 0;
    private wasShutdownRequested = false;
    private silenceWatchdogTimer: NodeJS.Timeout | null = null;
    private proactiveReconnectTimer: NodeJS.Timeout | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor(config: BinanceDepthFeedServiceConfig) {
        this.config = config;
        this.streamUrl = buildStreamUrl(config);

        this.handleSocketOpen = this.handleSocketOpen.bind(this);
        this.handleSocketMessage = this.handleSocketMessage.bind(this);
        this.handleSocketError = this.handleSocketError.bind(this);
        this.handleSocketClose = this.handleSocketClose.bind(this);
        this.handleSilenceElapse = this.handleSilenceElapse.bind(this);
        this.handleProactiveReconnectDue = this.handleProactiveReconnectDue.bind(this);
        this.handleReconnectDue = this.handleReconnectDue.bind(this);
    }

    /**
     * Opens the market data socket and keeps it open.
     */
    connect(): void {
        if (this.wasShutdownRequested) {
            throw new Error('This feed service was disconnected and cannot be reconnected');
        }
        const socket = new WebSocket(this.streamUrl);
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

        this.unlisten(socket);
        const { promise, resolve } = Promise.withResolvers<void>();
        socket.once('close', resolve);
        socket.close();
        await Promise.race([promise, delay(2_000)]);
        socket.terminate();
    }

    /**
     * Fetches a full depth ladder over REST.
     *
     * @returns The ladder and the update identifier it is current as of.
     * @throws DepthLadderUnavailableError when the venue rejects or times out the request.
     */
    async fetchDepthSnapshot(): Promise<DepthSnapshot> {
        const requestUrl = new URL('/fapi/v1/depth', this.config.restApiBaseUrl);
        requestUrl.searchParams.set('symbol', this.config.instrumentSymbol);
        requestUrl.searchParams.set('limit', String(this.config.depthSnapshotLevelLimit));

        let response: Response;
        try {
            response = await fetch(requestUrl, {
                signal: AbortSignal.timeout(this.config.snapshotRequestTimeoutMs),
            });
        } catch (error) {
            throw new DepthLadderUnavailableError('Depth ladder request did not complete', { cause: error });
        }

        if (!response.ok) {
            throw new DepthLadderUnavailableError(`Depth ladder request returned status ${response.status}`);
        }

        const payload = (await response.json()) as BinanceDepthLadderPayload;
        return {
            lastUpdateId: payload.lastUpdateId,
            bidLevels: payload.bids,
            askLevels: payload.asks,
        };
    }

    private listen(socket: WebSocket): void {
        socket.on('open', this.handleSocketOpen);
        socket.on('message', this.handleSocketMessage);
        socket.on('error', this.handleSocketError);
        socket.on('close', this.handleSocketClose);
    }

    private unlisten(socket: WebSocket): void {
        socket.off('open', this.handleSocketOpen);
        socket.off('message', this.handleSocketMessage);
        socket.off('error', this.handleSocketError);
        socket.off('close', this.handleSocketClose);
    }

    private handleSocketOpen(): void {
        this.consecutiveFailureCount = 0;
        this.restartSilenceWatchdog();
        this.scheduleProactiveReconnect();
        this.config.onConnected();
    }

    private handleSocketMessage(rawPayload: WebSocket.RawData): void {
        this.restartSilenceWatchdog();

        const payload = parseStreamPayload(rawPayload);
        if (payload === null) {
            return;
        }
        if (payload.e === 'depthUpdate') {
            this.config.onDepthDiff(toDepthDiff(payload));
            return;
        }
        this.config.onExecutedTrade(toExecutedTrade(payload));
    }

    private handleSocketError(error: Error): void {
        this.recycleConnection(`socket error: ${error.message}`);
    }

    private handleSocketClose(code: number): void {
        this.recycleConnection(`socket closed with code ${code}`);
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
        this.unlisten(socket);
        socket.terminate();
        this.activeSocket = null;

        this.config.onDisconnected(reason);
        if (this.wasShutdownRequested) {
            return;
        }

        this.consecutiveFailureCount += 1;
        this.reconnectTimer = setTimeout(this.handleReconnectDue, this.resolveBackoffDelay());
        this.reconnectTimer.unref();
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
        this.silenceWatchdogTimer.unref();
    }

    private scheduleProactiveReconnect(): void {
        if (this.proactiveReconnectTimer !== null) {
            clearTimeout(this.proactiveReconnectTimer);
        }
        this.proactiveReconnectTimer = setTimeout(
            this.handleProactiveReconnectDue,
            this.config.proactiveReconnectIntervalMs,
        );
        this.proactiveReconnectTimer.unref();
    }

    private clearTimers(): void {
        for (const timer of [this.silenceWatchdogTimer, this.proactiveReconnectTimer, this.reconnectTimer]) {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
        this.silenceWatchdogTimer = null;
        this.proactiveReconnectTimer = null;
        this.reconnectTimer = null;
    }
}

/**
 * Reads the payload out of a stream envelope, or null when the frame is not one
 * the collector subscribes to.
 *
 * The parse result is treated as unknown rather than asserted to be the
 * envelope: declaring the venue's wire shape as fact would turn a protocol
 * change into a silent misread instead of a discarded frame.
 */
function parseStreamPayload(rawPayload: WebSocket.RawData): BinanceStreamPayload | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(decodeFrameText(rawPayload));
    } catch {
        return null;
    }

    const envelope = parsed as { data?: unknown } | null;
    const payload = envelope?.data;
    if (typeof payload !== 'object' || payload === null) {
        return null;
    }

    const eventType = (payload as { e?: unknown }).e;
    if (eventType === 'depthUpdate') {
        return payload as BinanceDepthUpdatePayload;
    }
    if (eventType === 'trade') {
        return payload as BinanceTradePayload;
    }
    return null;
}

/**
 * Reassembles a frame the client may have delivered in fragments.
 *
 * A fragmented message arrives as an array of buffers, and calling `toString`
 * on that array joins the pieces with commas, producing text that no longer
 * parses — a whole depth update dropped without a trace.
 */
function decodeFrameText(rawPayload: WebSocket.RawData): string {
    if (Array.isArray(rawPayload)) {
        return Buffer.concat(rawPayload).toString('utf8');
    }
    if (rawPayload instanceof ArrayBuffer) {
        return Buffer.from(rawPayload).toString('utf8');
    }
    return rawPayload.toString('utf8');
}

function buildStreamUrl(config: BinanceDepthFeedServiceConfig): string {
    const lowercaseSymbol = config.instrumentSymbol.toLowerCase();
    const subscribedStreams = [
        `${lowercaseSymbol}@depth@${config.depthUpdateIntervalLabel}`,
        `${lowercaseSymbol}@trade`,
    ].join('/');
    return `${config.webSocketBaseUrl}/stream?streams=${subscribedStreams}`;
}

function toDepthDiff(payload: BinanceDepthUpdatePayload): DepthDiff {
    return {
        firstUpdateId: payload.U,
        finalUpdateId: payload.u,
        previousFinalUpdateId: payload.pu,
        bidLevels: payload.b,
        askLevels: payload.a,
    };
}

function toExecutedTrade(payload: BinanceTradePayload): ExecutedTrade {
    return {
        executedAtMs: payload.T,
        price: Number(payload.p),
        quantity: Number(payload.q),
        isAggressorSelling: payload.m,
    };
}
