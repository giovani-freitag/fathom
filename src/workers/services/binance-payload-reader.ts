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
export function parseStreamPayload(frameText: string): BinanceStreamPayload | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(frameText);
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
