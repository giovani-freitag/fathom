import {
    API_ROUTES,
    decodeLiquidityFrameWindow,
    type LiquidityFrameWindow,
    type LiveTextMessage,
} from '@fathom/contracts';

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAXIMUM_RECONNECT_DELAY_MS = 15_000;

export type LiveFeedStatus = 'idle' | 'connecting' | 'streaming' | 'reconnecting';

export interface LiveFeedServiceConfig {
    /** Absolute origin of the gateway; the scheme is swapped for the socket one. */
    readonly baseUrl: string;
}

/**
 * One viewer's tail.
 *
 * The delivery callbacks belong to the subscription rather than the service so
 * the consumer can be built after it: a controller needs the feed, and the feed
 * needs the controller's handlers.
 */
export interface LiveFeedSubscription {
    readonly instrumentSymbol: string;
    /** Newest frame already held; the tail resumes strictly after it. */
    readonly afterMs: number;
    readonly onFrames: (window: LiquidityFrameWindow) => void;
    readonly onText: (message: LiveTextMessage) => void;
    readonly onStatusChanged: (status: LiveFeedStatus) => void;
}

/**
 * The only place the live socket is spoken.
 *
 * Reconnects on its own with backoff, resuming from the newest frame it has
 * delivered rather than from the original request, so a dropped connection
 * costs latency instead of a hole in the chart.
 */
export class LiveFeedService {
    private readonly config: LiveFeedServiceConfig;

    private socket: WebSocket | null = null;
    private subscription: LiveFeedSubscription | null = null;
    private newestFrameMs = 0;
    private consecutiveFailureCount = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private wasStopped = false;

    constructor(config: LiveFeedServiceConfig) {
        this.config = config;
        this.handleSocketOpen = this.handleSocketOpen.bind(this);
        this.handleSocketMessage = this.handleSocketMessage.bind(this);
        this.handleSocketClose = this.handleSocketClose.bind(this);
        this.handleReconnectDue = this.handleReconnectDue.bind(this);
    }

    /**
     * Points the feed at an instrument, replacing any current subscription.
     *
     * @param subscription - Instrument and the instant to resume after.
     */
    connect(subscription: LiveFeedSubscription): void {
        this.disconnect();
        this.wasStopped = false;
        this.subscription = subscription;
        this.newestFrameMs = subscription.afterMs;
        this.consecutiveFailureCount = 0;
        this.openSocket();
    }

    /**
     * Closes the socket and cancels any pending reconnect.
     */
    disconnect(): void {
        this.wasStopped = true;
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.closeSocket();
        this.subscription?.onStatusChanged('idle');
    }

    private openSocket(): void {
        const subscription = this.subscription;
        if (subscription === null || this.wasStopped) {
            return;
        }

        const socketUrl = new URL(`${this.config.baseUrl}${API_ROUTES.live}`);
        socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        socketUrl.searchParams.set('symbol', subscription.instrumentSymbol);
        socketUrl.searchParams.set('afterMs', String(Math.floor(this.newestFrameMs)));

        const socket = new WebSocket(socketUrl);
        socket.binaryType = 'arraybuffer';
        socket.addEventListener('open', this.handleSocketOpen);
        socket.addEventListener('message', this.handleSocketMessage);
        socket.addEventListener('close', this.handleSocketClose);
        socket.addEventListener('error', this.handleSocketClose);
        this.socket = socket;

        subscription.onStatusChanged(this.consecutiveFailureCount === 0 ? 'connecting' : 'reconnecting');
    }

    private closeSocket(): void {
        const socket = this.socket;
        this.socket = null;
        if (socket === null) {
            return;
        }
        socket.removeEventListener('open', this.handleSocketOpen);
        socket.removeEventListener('message', this.handleSocketMessage);
        socket.removeEventListener('close', this.handleSocketClose);
        socket.removeEventListener('error', this.handleSocketClose);
        socket.close();
    }

    private handleSocketOpen(): void {
        this.consecutiveFailureCount = 0;
        this.subscription?.onStatusChanged('streaming');
    }

    private handleSocketMessage(event: MessageEvent<unknown>): void {
        if (event.data instanceof ArrayBuffer) {
            this.deliverFrames(event.data);
            return;
        }
        if (typeof event.data === 'string') {
            this.deliverText(event.data);
        }
    }

    private deliverFrames(buffer: ArrayBuffer): void {
        const window = decodeLiquidityFrameWindow(buffer);
        const newestFrame = window.frames[window.frames.length - 1];
        if (newestFrame !== undefined) {
            this.newestFrameMs = Math.max(this.newestFrameMs, newestFrame.capturedAtMs);
        }
        this.subscription?.onFrames(window);
    }

    private deliverText(payload: string): void {
        try {
            this.subscription?.onText(JSON.parse(payload) as LiveTextMessage);
        } catch {
            // A malformed text frame is not worth tearing the socket down for.
        }
    }

    private handleSocketClose(): void {
        this.closeSocket();
        if (this.wasStopped) {
            return;
        }

        this.consecutiveFailureCount += 1;
        this.subscription?.onStatusChanged('reconnecting');
        this.reconnectTimer = setTimeout(this.handleReconnectDue, this.resolveBackoffDelay());
    }

    private handleReconnectDue(): void {
        this.reconnectTimer = null;
        this.openSocket();
    }

    private resolveBackoffDelay(): number {
        const exponential = INITIAL_RECONNECT_DELAY_MS * 2 ** (this.consecutiveFailureCount - 1);
        return Math.min(exponential, MAXIMUM_RECONNECT_DELAY_MS);
    }
}
