import type WebSocket from 'ws';
import type { DepthDiff, ExecutedTrade } from '../core/depth-types.ts';
import type {
    BinanceDepthUpdatePayload,
    BinanceStreamPayload,
    BinanceTradePayload,
} from './binance-payloads.ts';

/**
 * Reads the payload out of a stream envelope, or null when the frame is not one
 * the collector subscribes to.
 *
 * The parse result is treated as unknown rather than asserted to be the
 * envelope: declaring the venue's wire shape as fact would turn a protocol
 * change into a silent misread instead of a discarded frame.
 */
export function parseStreamPayload(rawPayload: WebSocket.RawData): BinanceStreamPayload | null {
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

export function toDepthDiff(payload: BinanceDepthUpdatePayload): DepthDiff {
    return {
        firstUpdateId: payload.U,
        finalUpdateId: payload.u,
        previousFinalUpdateId: payload.pu,
        bidLevels: payload.b,
        askLevels: payload.a,
    };
}

export function toExecutedTrade(payload: BinanceTradePayload): ExecutedTrade {
    return {
        executedAtMs: payload.T,
        price: Number(payload.p),
        quantity: Number(payload.q),
        isAggressorSelling: payload.m,
    };
}
