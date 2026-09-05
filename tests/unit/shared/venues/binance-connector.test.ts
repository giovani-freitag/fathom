import { describe, expect, it } from 'vitest';
import { BINANCE_CONNECTOR } from '../../../../src/shared/venues/binance-connector.ts';
import { findContradictions } from '../../../../src/shared/core/venue-connector.ts';

const EXCHANGE_INFO = {
    symbols: [
        {
            symbol: 'BTCUSDT',
            baseAsset: 'BTC',
            quoteAsset: 'USDT',
            status: 'TRADING',
            filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }],
        },
        {
            symbol: 'DEADUSDT',
            baseAsset: 'DEAD',
            quoteAsset: 'USDT',
            status: 'SETTLING',
            filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.001' }],
        },
    ],
};

/** One candle, in the tuple the venue actually sends. */
const CANDLE = [
    1_700_000_000_000, '42000.0', '42500.0', '41900.0', '42400.0', '120.5',
    1_700_000_059_999, '5100000', 830, '70.25', '2900000', '0',
];

describe('the connector for the venue every recording came from', () => {
    it('declares what it reads and reads what it declares', () => {
        expect(findContradictions(BINANCE_CONNECTOR)).toEqual([]);
    });
});

describe('its listing', () => {
    it('names each pair by its base and its quote', () => {
        const listed = BINANCE_CONNECTOR.instruments.readInstruments(EXCHANGE_INFO);

        expect(listed[0]).toEqual({
            symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', priceStep: 0.1, isTrading: true,
        });
    });

    it('keeps a listing that is not trading, saying so rather than hiding it', () => {
        // A pair that was recorded and has since stopped trading still has a
        // history worth opening, and dropping it from the listing would make the
        // recording unreachable from the interface that filed it.
        const listed = BINANCE_CONNECTOR.instruments.readInstruments(EXCHANGE_INFO);

        expect(listed.map((instrument) => instrument.isTrading)).toEqual([true, false]);
    });

    it('refuses an answer that lists nothing at all', () => {
        expect(() => BINANCE_CONNECTOR.instruments.readInstruments({})).toThrow(/listed no symbols/);
    });
});

describe('its candles', () => {
    it('reads the split the venue publishes, which most venues do not', () => {
        const [bar] = BINANCE_CONNECTOR.bars!.readPage([CANDLE]);

        expect(bar?.volume).toBe(120.5);
        expect(bar?.buyVolume).toBe(70.25);
    });

    it('closes the bar on the first instant it does not hold', () => {
        // The venue closes on the last millisecond it holds; the chart treats
        // the edge as the first it does not, and an off-by-one here folds one
        // bar's last print into the next bucket.
        const [bar] = BINANCE_CONNECTOR.bars!.readPage([CANDLE]);

        expect(bar?.closedAtMs).toBe(1_700_000_060_000);
    });

    it('drops a candle short of the fields it is read by', () => {
        expect(BINANCE_CONNECTOR.bars!.readPage([[1, '2', '3']])).toEqual([]);
    });

    it('asks for the width by the name the venue gives it', () => {
        const asked = BINANCE_CONNECTOR.bars!.planPage({
            symbol: 'BTCUSDT', widthMs: 3_600_000, fromMs: 1_000, toMs: 2_000, limit: 500,
        });

        expect(asked.url).toContain('interval=1h');
        expect(asked.url).toContain('symbol=BTCUSDT');
    });

    it('refuses a width the venue serves no candle at', () => {
        expect(() => BINANCE_CONNECTOR.bars!.planPage({
            symbol: 'BTCUSDT', widthMs: 7_000, fromMs: 1_000, toMs: 2_000, limit: 500,
        })).toThrow(/No venue candle/);
    });
});

describe('its book', () => {
    it('reads an update with its whole sequence, which is what makes it checkable', () => {
        const update = BINANCE_CONNECTOR.book!.readUpdate({
            data: { e: 'depthUpdate', U: 10, u: 12, pu: 9, b: [['42000', '1.5']], a: [] },
        });

        expect(update).toEqual({
            firstUpdateId: 10,
            finalUpdateId: 12,
            previousFinalUpdateId: 9,
            bidLevels: [['42000', '1.5']],
            askLevels: [],
        });
    });

    it('ignores an update missing a side, rather than handing on something to iterate', () => {
        const update = BINANCE_CONNECTOR.book!.readUpdate({
            data: { e: 'depthUpdate', U: 10, u: 12, pu: 9, b: [['42000', '1.5']] },
        });

        expect(update).toBeNull();
    });

    it('ignores anything on the stream that is not a book update', () => {
        expect(BINANCE_CONNECTOR.book!.readUpdate({ data: { e: 'trade' } })).toBeNull();
        expect(BINANCE_CONNECTOR.book!.readUpdate({ data: { e: 'kline', k: {} } })).toBeNull();
    });

    it('ignores a frame carrying no payload, which is how the venue acknowledges', () => {
        expect(BINANCE_CONNECTOR.book!.readUpdate({ result: null, id: 1 })).toBeNull();
    });

    it('ignores an update with no sequence to place it in', () => {
        const update = BINANCE_CONNECTOR.book!.readUpdate({
            data: { e: 'depthUpdate', b: [], a: [] },
        });

        expect(update).toBeNull();
    });
});

describe('its tape', () => {
    it('names the side that crossed the spread', () => {
        const prints = BINANCE_CONNECTOR.tape!.readTrades({
            data: { e: 'trade', T: 1_700_000_000_000, m: true, p: '42000.5', q: '0.75' },
        });

        expect(prints).toEqual([{
            executedAtMs: 1_700_000_000_000,
            price: 42_000.5,
            quantity: 0.75,
            isAggressorSelling: true,
        }]);
    });

    it('reads a print the resting seller absorbed as a purchase', () => {
        const [print] = BINANCE_CONNECTOR.tape!.readTrades({
            data: { e: 'trade', T: 1_700_000_000_000, m: false, p: '42000.5', q: '0.75' },
        });

        expect(print?.isAggressorSelling).toBe(false);
    });

    it('drops a print with no instant of its own', () => {
        const prints = BINANCE_CONNECTOR.tape!.readTrades({
            data: { e: 'trade', m: true, p: '42000.5', q: '0.75' },
        });

        expect(prints).toEqual([]);
    });

    it('drops a print whose price does not read as a number', () => {
        // A price that reads as NaN is written as a real print, and no later
        // read can tell it from one.
        const prints = BINANCE_CONNECTOR.tape!.readTrades({
            data: { e: 'trade', T: 1_700_000_000_000, m: true, p: 'nonsense', q: '0.75' },
        });

        expect(prints).toEqual([]);
    });
});
