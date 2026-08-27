import { describe, expect, it } from 'vitest';
import {
    parseStreamPayload,
    toDepthDiff,
    toExecutedTrade,
} from '../../../src/workers/services/binance-payload-reader.ts';
import type {
    BinanceDepthUpdatePayload,
    BinanceTradePayload,
} from '../../../src/workers/services/binance-payloads.ts';

/** One frame, as the venue wraps it for a combined stream. */
function wrapFrame(payload: unknown): string {
    return JSON.stringify({ stream: 'btcusdt@depth@100ms', data: payload });
}

const DEPTH_UPDATE: BinanceDepthUpdatePayload = {
    e: 'depthUpdate',
    E: 1_700_000_000_000,
    T: 1_700_000_000_000,
    s: 'BTCUSDT',
    U: 100,
    u: 110,
    pu: 99,
    b: [['100', '5']],
    a: [['101', '6']],
};

const TRADE: BinanceTradePayload = {
    e: 'trade',
    s: 'BTCUSDT',
    p: '100.5',
    q: '0.25',
    T: 1_700_000_000_000,
    m: true,
};

describe('parseStreamPayload', () => {
    it('reads a depth update out of its envelope', () => {
        const payload = parseStreamPayload(wrapFrame(DEPTH_UPDATE));

        expect(payload).toEqual(DEPTH_UPDATE);
    });

    it('reads a trade out of its envelope', () => {
        const payload = parseStreamPayload(wrapFrame(TRADE));

        expect(payload).toEqual(TRADE);
    });

    it('refuses a frame that is not JSON', () => {
        const payload = parseStreamPayload('<html>gateway timeout</html>');

        expect(payload).toBeNull();
    });

    it('refuses a frame carrying no payload', () => {
        const payload = parseStreamPayload(JSON.stringify({ result: null, id: 1 }));

        expect(payload).toBeNull();
    });

    it('refuses an event the collector did not subscribe to', () => {
        const payload = parseStreamPayload(wrapFrame({ e: 'kline', k: {} }));

        expect(payload).toBeNull();
    });

    it('refuses a depth update whose sides are not lists of levels', () => {
        // Read as an update, an absent side reaches the mirror and throws inside
        // the socket's own message handler.
        const payload = parseStreamPayload(wrapFrame({ ...DEPTH_UPDATE, b: undefined }));

        expect(payload).toBeNull();
    });

    it('refuses a depth update with no sequence to place it in', () => {
        const payload = parseStreamPayload(wrapFrame({ ...DEPTH_UPDATE, pu: 'not a number' }));

        expect(payload).toBeNull();
    });

    it('refuses a trade with no price', () => {
        // A price that reads as NaN is written to the archive as a real print,
        // and no later read can tell it from one.
        const payload = parseStreamPayload(wrapFrame({ ...TRADE, p: undefined }));

        expect(payload).toBeNull();
    });

    it('refuses a trade with no instant of its own', () => {
        const payload = parseStreamPayload(wrapFrame({ ...TRADE, T: undefined }));

        expect(payload).toBeNull();
    });
});

describe('toDepthDiff', () => {
    it('names the venue sequence fields for what they mean', () => {
        const diff = toDepthDiff(DEPTH_UPDATE);

        expect(diff).toEqual({
            firstUpdateId: 100,
            finalUpdateId: 110,
            previousFinalUpdateId: 99,
            bidLevels: [['100', '5']],
            askLevels: [['101', '6']],
        });
    });
});

describe('toExecutedTrade', () => {
    it('reads a print the resting buyer absorbed as a sale', () => {
        const trade = toExecutedTrade(TRADE);

        expect(trade).toEqual({
            executedAtMs: 1_700_000_000_000,
            price: 100.5,
            quantity: 0.25,
            isAggressorSelling: true,
        });
    });

    it('reads a print the resting seller absorbed as a purchase', () => {
        const trade = toExecutedTrade({ ...TRADE, m: false });

        expect(trade.isAggressorSelling).toBe(false);
    });
});
