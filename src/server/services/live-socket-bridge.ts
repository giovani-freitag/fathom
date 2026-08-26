import { encodeLiquidityFrameWindow } from '../../shared/codec/heatmap-codec.ts';
import type { LiveMessage } from '../../shared/core/live-message.ts';
import type { LiveTailService, Unsubscribe } from './live-tail-service.ts';
import type { WebSocket } from '@fastify/websocket';

export interface LiveSocketBridgeConfig {
    readonly socket: WebSocket;
    readonly liveTail: LiveTailService;
    readonly instrumentSymbol: string;
    readonly afterMs: number;
    readonly priceBucketSize: number;
}

/**
 * Binds one tail subscription to one socket.
 */
export class LiveSocketBridge {
    private readonly config: LiveSocketBridgeConfig;
    private unsubscribe: Unsubscribe | null = null;

    constructor(config: LiveSocketBridgeConfig) {
        this.config = config;
        this.handleMessage = this.handleMessage.bind(this);
        this.handleSocketClose = this.handleSocketClose.bind(this);
    }

    /**
     * Subscribes the socket to the tail and begins forwarding.
     */
    start(): void {
        this.config.socket.on('close', this.handleSocketClose);
        this.config.socket.on('error', this.handleSocketClose);

        try {
            this.unsubscribe = this.config.liveTail.subscribe({
                instrumentSymbol: this.config.instrumentSymbol,
                afterMs: this.config.afterMs,
                priceBucketSize: this.config.priceBucketSize,
                onMessage: this.handleMessage,
            });
        } catch (error) {
            this.config.socket.close(1013, describeRefusal(error));
        }
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

    /**
     * Writes one message, in whichever form the wire carries it best.
     *
     * A window of frames is two typed arrays per column, which JSON would send
     * as digits; every other message is a handful of fields, which the codec
     * would need a case for. The type is one either way.
     */
    private handleMessage(message: LiveMessage): void {
        if (!this.isSocketWritable()) {
            return;
        }
        if (message.kind === 'frames') {
            this.config.socket.send(Buffer.from(encodeLiquidityFrameWindow(message.window)));
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

function describeRefusal(error: unknown): string {
    return error instanceof Error ? error.message : 'Live tail refused';
}
