import { describe, expect, it } from 'vitest';
import { BYBIT_CONNECTOR } from '../../../../src/shared/venues/bybit-connector.ts';
import { findContradictions } from '../../../../src/shared/core/venue-connector.ts';

/** One listing, as the venue's own answer carries it. */
const LISTING = {
    result: {
        list: [{
            symbol: 'BTCUSDT',
            baseCoin: 'BTC',
            quoteCoin: 'USDT',
            status: 'Trading',
            priceFilter: { tickSize: '0.10' },
        }],
        nextPageCursor: 'first%3DAUSDT%26last%3DZUSDT',
    },
};

const ASKED = {
    symbol: 'BTCUSDT',
    widthMs: 60_000,
    fromMs: 1_788_621_840_000,
    toMs: 1_788_621_960_000,
    limit: 1_000,
};

/** Two candles, newest first, exactly as the venue sends them. */
const CANDLES = {
    result: {
        list: [
            ['1788621900000', '79724.5', '79730.0', '79724.4', '79724.5', '1.247', '99416.4244'],
            ['1788621840000', '79707.2', '79738.6', '79707.1', '79724.5', '54.422', '4338978.2588'],
        ],
    },
};

describe('the connector for a venue that pages by cursor', () => {
    it('declares what it reads and reads what it declares', () => {
        expect(findContradictions(BYBIT_CONNECTOR)).toEqual([]);
    });

    it('asks for the next page by the cursor the last one carried', () => {
        // The paging this venue offers, and the only shape a total cannot
        // replace: the address of page two does not exist until page one lands.
        const next = BYBIT_CONNECTOR.continueInstruments(LISTING, 1_000);

        expect(next?.url).toContain('cursor=first%253DAUSDT%2526last%253DZUSDT');
    });

    it('stops when the venue hands out no cursor at all', () => {
        expect(BYBIT_CONNECTOR.continueInstruments({ result: { list: [], nextPageCursor: '' } }, 1)).toBeNull();
    });

    it('names each pair by its own two coins', () => {
        expect(BYBIT_CONNECTOR.readInstruments(LISTING)).toEqual([{
            symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', priceStep: 0.1, isTrading: true,
        }]);
    });

    it('hands back a page oldest first, though the venue sends it newest first', () => {
        const page = BYBIT_CONNECTOR.readBars(CANDLES, ASKED);

        expect(page.map((bar) => bar.openedAtMs)).toEqual([1_788_621_840_000, 1_788_621_900_000]);
    });

    it('closes each candle by the width it asked for, which the venue never names', () => {
        const [bar] = BYBIT_CONNECTOR.readBars(CANDLES, ASKED);

        expect(bar?.closedAtMs).toBe(1_788_621_840_000 + 60_000);
        expect(bar?.buyVolume).toBeNull();
        expect(bar?.tradeCount).toBeNull();
    });

    it('reads a delta as one past the update before it', () => {
        // This venue numbers its updates one at a time and never says which one
        // came before, so the mirror is joined by that rule or not at all.
        const diff = BYBIT_CONNECTOR.readUpdate({
            topic: 'orderbook.200.BTCUSDT',
            type: 'delta',
            data: { s: 'BTCUSDT', b: [['79671.70', '0.008']], a: [], u: 38_106_133 },
        });

        expect(diff?.firstUpdateId).toBe(38_106_133);
        expect(diff?.previousFinalUpdateId).toBe(38_106_132);
    });

    it('leaves the socket\'s own snapshot alone, having fetched one already', () => {
        expect(BYBIT_CONNECTOR.readUpdate({
            topic: 'orderbook.200.BTCUSDT',
            type: 'snapshot',
            data: { s: 'BTCUSDT', b: [], a: [], u: 1 },
        })).toBeNull();
    });

    it('asks for the ladder at the depth its socket publishes', () => {
        // A mirror seeded deeper than the updates that maintain it keeps rows
        // nothing will ever correct.
        expect(BYBIT_CONNECTOR.planSnapshot('BTCUSDT').url).toContain('limit=200');
        expect(BYBIT_CONNECTOR.planStream('BTCUSDT', '').greetings?.[0]).toContain('orderbook.200.BTCUSDT');
    });

    it('reads a print by the side that crossed the spread', () => {
        const [print] = BYBIT_CONNECTOR.readTrades({
            topic: 'publicTrade.BTCUSDT',
            type: 'snapshot',
            data: [{ T: 1_788_622_000_000, s: 'BTCUSDT', S: 'Sell', v: '0.5', p: '79700.5', i: 'x' }],
        });

        expect(print?.isAggressorSelling).toBe(true);
        expect(print?.price).toBe(79_700.5);
    });

    it('says nothing about a message that belongs to another subscription', () => {
        expect(BYBIT_CONNECTOR.readTrades({ topic: 'orderbook.200.BTCUSDT', data: [] })).toEqual([]);
        expect(BYBIT_CONNECTOR.readUpdate({ topic: 'publicTrade.BTCUSDT', data: [] })).toBeNull();
    });

    it('declares every width it can name, and no other', () => {
        for (const rung of BYBIT_CONNECTOR.declaration.bars?.rungs ?? []) {
            expect(() => BYBIT_CONNECTOR.planBars({ ...ASKED, widthMs: rung.widthMs })).not.toThrow();
        }
        expect(() => BYBIT_CONNECTOR.planBars({ ...ASKED, widthMs: 7_000 })).toThrow(/No venue candle/);
    });
});
