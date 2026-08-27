import type { DepthDiff, ExecutedTrade } from '../core/depth-types.ts';
import type {
    BinanceDepthUpdatePayload,
    BinanceStreamPayload,
    BinanceTradePayload,
} from './binance-payloads.ts';

/**
 * Reads a subscribed payload out of a stream envelope.
 *
 * @param frameText - One frame, decoded as UTF-8.
 * @returns The payload, or null when the frame carries nothing readable.
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
    if (eventType === 'depthUpdate' && isDepthUpdatePayload(payload)) {
        return payload;
    }
    if (eventType === 'trade' && isTradePayload(payload)) {
        return payload;
    }
    return null;
}

/**
 * Whether a payload is a depth update the mirror can apply.
 *
 * @param payload - The decoded payload, whatever it turned out to be.
 * @returns True when both sides and the whole sequence are there.
 */
function isDepthUpdatePayload(payload: object): payload is BinanceDepthUpdatePayload {
    // An absent side reaches the mirror as something to iterate over, and throws
    // inside the socket's own message handler.
    const candidate = payload as Partial<BinanceDepthUpdatePayload>;
    return typeof candidate.U === 'number'
        && typeof candidate.u === 'number'
        && typeof candidate.pu === 'number'
        && Array.isArray(candidate.b)
        && Array.isArray(candidate.a);
}

/**
 * Whether a payload is a print the archive can hold.
 *
 * @param payload - The decoded payload, whatever it turned out to be.
 * @returns True when price, quantity and instant are all readable.
 */
function isTradePayload(payload: object): payload is BinanceTradePayload {
    // A price that reads as NaN is written as a real print, and no later read
    // can tell it from one.
    const candidate = payload as Partial<BinanceTradePayload>;
    return typeof candidate.T === 'number'
        && typeof candidate.m === 'boolean'
        && isNumericText(candidate.p)
        && isNumericText(candidate.q);
}

/**
 * Whether a field carries a number the venue wrote as text.
 *
 * @param field - The field as it was decoded.
 * @returns True when it reads as a finite number.
 */
function isNumericText(field: unknown): boolean {
    return typeof field === 'string' && field.length > 0 && Number.isFinite(Number(field));
}

/**
 * Names the venue's sequence fields for what they mean.
 *
 * @param payload - One depth update, as the venue publishes it.
 * @returns The same update in venue-neutral form.
 */
export function toDepthDiff(payload: BinanceDepthUpdatePayload): DepthDiff {
    return {
        firstUpdateId: payload.U,
        finalUpdateId: payload.u,
        previousFinalUpdateId: payload.pu,
        bidLevels: payload.b,
        askLevels: payload.a,
    };
}

/**
 * Reads one print, with the side that crossed the spread named.
 *
 * @param payload - One trade, as the venue publishes it.
 * @returns The print in venue-neutral form.
 */
export function toExecutedTrade(payload: BinanceTradePayload): ExecutedTrade {
    return {
        executedAtMs: payload.T,
        price: Number(payload.p),
        quantity: Number(payload.q),
        isAggressorSelling: payload.m,
    };
}
