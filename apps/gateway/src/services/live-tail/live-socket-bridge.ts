import {
    encodeLiquidityFrameWindow,
    type LiquidityFrameWindow,
    type LiveTextMessage,
} from '@fathom/contracts';
import type { WebSocket } from '@fastify/websocket';
import type { LiveTailService, Unsubscribe } from './live-tail-service.ts';

export interface LiveSocketBridgeConfig {
    readonly socket: WebSocket;
    readonly liveTail: LiveTailService;
    readonly instrumentSymbol: string;
    readonly afterMs: number;
    readonly priceBucketSize: number;
}

/**
 * Binds one tail subscription to one socket.
 *
 * Frames go out as binary in the same format the history route serves, so the
 * viewer decodes live and historical depth with one code path; everything else
 * goes out as text, and the receiver dispatches on the message type.
 */
export class LiveSocketBridge {
    private readonly config: LiveSocketBridgeConfig;
    private unsubscribe: Unsubscribe | null = null;

    constructor(config: LiveSocketBridgeConfig) {
        this.config = config;
        this.handleFrames = this.handleFrames.bind(this);
        this.handleText = this.handleText.bind(this);
        this.handleSocketClose = this.handleSocketClose.bind(this);
    }

    /**
     * Announces the subscription and begins forwarding.
     */
    start(): void {
        this.config.socket.on('close', this.handleSocketClose);
        this.config.socket.on('error', this.handleSocketClose);

        this.handleText({
            kind: 'subscribed',
            instrumentSymbol: this.config.instrumentSymbol,
            priceBucketSize: this.config.priceBucketSize,
        });

        this.unsubscribe = this.config.liveTail.subscribe({
            instrumentSymbol: this.config.instrumentSymbol,
            afterMs: this.config.afterMs,
            onFrames: this.handleFrames,
            onText: this.handleText,
        });
    }

    /**
     * Cancels the subscription and detaches from the socket.
     */
    stop(): void {
        this.config.socket.off('close', this.handleSocketClose);
        this.config.socket.off('error', this.handleSocketClose);
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    private handleFrames(window: LiquidityFrameWindow): void {
        if (!this.isSocketWritable()) {
            return;
        }
        this.config.socket.send(Buffer.from(encodeLiquidityFrameWindow(window)));
    }

    private handleText(message: LiveTextMessage): void {
        if (!this.isSocketWritable()) {
            return;
        }
        this.config.socket.send(JSON.stringify(message));
    }

    private handleSocketClose(): void {
        this.stop();
    }

    private isSocketWritable(): boolean {
        return this.config.socket.readyState === this.config.socket.OPEN;
    }
}
