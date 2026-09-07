import { encodeLiquidityFrameWindow } from '../../shared/codec/heatmap-codec.ts';
import type { LiveMessage } from '../../shared/core/live-message.ts';
import { type LiveTailService, type Unsubscribe, UnknownTailSourceError } from './live-tail-service.ts';
import type { WebSocket } from '@fastify/websocket';

export interface LiveSocketBridgeConfig {
    readonly socket: WebSocket;
    readonly liveTail: LiveTailService;
    readonly venue: string;
    readonly instrumentSymbol: string;
    readonly afterMs: number;
    readonly priceBucketSize: number;
    /** Which store the reader is drawing, or absent for the frame table. */
    /** The prices on screen, so the tail carries only those. */
    readonly lowPrice?: number;
    readonly highPrice?: number;
    /** What one instant of the recording covers, so no read is folded. */
    readonly frameIntervalMs?: number;
    /** Where a tail that has stopped reading is reported, if anywhere. */
    readonly log?: { readonly warning: (said: string, detail?: unknown) => void } | undefined;
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
        this.handleAdvanceFailed = this.handleAdvanceFailed.bind(this);
    }

    /**
     * Subscribes the socket to the tail and begins forwarding.
     */
    start(): void {
        this.config.socket.on('close', this.handleSocketClose);
        this.config.socket.on('error', this.handleSocketClose);

        try {
            this.unsubscribe = this.config.liveTail.subscribe({
                venue: this.config.venue,
                instrumentSymbol: this.config.instrumentSymbol,
                afterMs: this.config.afterMs,
                priceBucketSize: this.config.priceBucketSize,
                onMessage: this.handleMessage,
                onAdvanceFailed: this.handleAdvanceFailed,
                ...(this.config.lowPrice === undefined ? {} : { lowPrice: this.config.lowPrice }),
                ...(this.config.highPrice === undefined
                    ? {}
                    : { highPrice: this.config.highPrice }),
                ...(this.config.frameIntervalMs === undefined
                    ? {}
                    : { frameIntervalMs: this.config.frameIntervalMs }),
            });
        } catch (error) {
            this.config.socket.close(refusalCloseCode(error), describeRefusal(error));
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

    /**
     * Lets the socket go once a run of passes has read nothing.
     *
     * One failed pass is nothing — the cursors did not move, so the next reads
     * the same range. A tail whose every pass fails held its socket open and
     * delivered nothing, for as long as the reader left the page open, with no
     * word on either side of the wire. Closed with the code that means "try
     * again", because that is what it is: the client reconnects and resumes.
     */
    private handleAdvanceFailed(failuresInARow: number, reason: unknown): void {
        if (failuresInARow < PASSES_BEFORE_LETTING_GO) {
            return;
        }
        this.config.log?.warning('A live tail could not read, and was let go', {
            venue: this.config.venue,
            instrumentSymbol: this.config.instrumentSymbol,
            failuresInARow,
            reason: reason instanceof Error ? reason.message : String(reason),
        });
        this.config.socket.close(SOCKET_TRY_AGAIN_LATER, 'Could not read what is recorded');
    }

    private handleSocketClose(): void {
        this.stop();
    }

    private isSocketWritable(): boolean {
        return this.config.socket.readyState === this.config.socket.OPEN;
    }
}

/**
 * How many passes in a row may fail before the socket is let go.
 *
 * More than one, because a single unavailable read costs the reader the stretch
 * that arrives while they reconnect. Few enough that a tail which has stopped
 * reading for good does not sit there delivering nothing.
 */
const PASSES_BEFORE_LETTING_GO = 5;

/** Close code for a refusal that will still stand however long the viewer waits. */
const SOCKET_POLICY_VIOLATION = 1008;

/** Close code for a refusal a later attempt may get past. */
const SOCKET_TRY_AGAIN_LATER = 1013;

/**
 * How permanent a refusal is, in the code the viewer reads.
 *
 * A full tail budget frees up, so a viewer should come back for it. A store the
 * gateway was never wired with never appears, and a viewer told to try again
 * reconnects for ever without one frame ever arriving — a chart that looks
 * connected and never moves.
 */
function refusalCloseCode(error: unknown): number {
    return error instanceof UnknownTailSourceError
        ? SOCKET_POLICY_VIOLATION
        : SOCKET_TRY_AGAIN_LATER;
}

function describeRefusal(error: unknown): string {
    return error instanceof Error ? error.message : 'Live tail refused';
}
