import { describe, expect, it } from 'vitest';
import { COINBASE_CONNECTOR } from '../../../../src/shared/venues/coinbase-connector.ts';
import { findContradictions } from '../../../../src/shared/core/venue-connector.ts';

const ASKED = {
    symbol: 'BTC-USD',
    widthMs: 60_000,
    fromMs: 1_788_621_600_000,
    toMs: 1_788_621_720_000,
    limit: 300,
};

/** Two candles, newest first, in the venue's own field order. */
const CANDLES = [
    [1_788_621_660, 79_750.79, 79_766.7, 79_757, 79_752.38, 8.83405921],
    [1_788_621_600, 79_689.99, 79_760.94, 79_689.99, 79_757, 9.93396784],
];

describe('the connector for a venue whose book is behind a key', () => {
    it('declares what it reads and reads what it declares', () => {
        expect(findContradictions(COINBASE_CONNECTOR)).toEqual([]);
    });

    it('declares no book, because the one it publishes needs signing in', () => {
        // There is nowhere in Fathom to keep a key, by design. What is left is
        // everything this venue says in public.
        expect(COINBASE_CONNECTOR.declaration.book).toBeNull();
        expect(COINBASE_CONNECTOR.declaration.tape).not.toBeNull();
    });

    it('reads a listing that arrives with no envelope around it', () => {
        const listed = COINBASE_CONNECTOR.readInstruments([{
            id: 'BTC-USD',
            base_currency: 'BTC',
            quote_currency: 'USD',
            quote_increment: '0.01',
            status: 'online',
            trading_disabled: false,
        }]);

        expect(listed).toEqual([{
            symbol: 'BTC-USD', base: 'BTC', quote: 'USD', priceStep: 0.01, isTrading: true,
        }]);
    });

    it('reads either way of being closed as not trading', () => {
        const listed = COINBASE_CONNECTOR.readInstruments([
            { id: 'A-USD', base_currency: 'A', quote_currency: 'USD', status: 'delisted' },
            { id: 'B-USD', base_currency: 'B', quote_currency: 'USD', status: 'online', trading_disabled: true },
        ]);

        expect(listed.map((one) => one.isTrading)).toEqual([false, false]);
    });

    it('reads the venue\'s field order, which puts the low and the high first', () => {
        // Read as the usual order, the open would be the low on every candle
        // and the chart would draw a market that never gaps.
        const [bar] = COINBASE_CONNECTOR.readBars(CANDLES, ASKED);

        expect(bar?.lowPrice).toBe(79_689.99);
        expect(bar?.highPrice).toBe(79_760.94);
        expect(bar?.openPrice).toBe(79_689.99);
        expect(bar?.closePrice).toBe(79_757);
    });

    it('reads the instant as seconds, because that is what the venue sends', () => {
        const [bar] = COINBASE_CONNECTOR.readBars(CANDLES, ASKED);

        expect(bar?.openedAtMs).toBe(1_788_621_600_000);
    });

    it('reads a print by the taker, though the venue names the maker', () => {
        // The one field on this venue that means the opposite of what it says.
        // Read as the aggressor's side it reverses every print, and a tape that
        // is exactly wrong still looks like a tape.
        const [print] = COINBASE_CONNECTOR.readTrades({
            type: 'match',
            side: 'sell',
            size: '0.00062101',
            price: '79709.31',
            product_id: 'BTC-USD',
            time: '2026-09-05T15:32:42.873892Z',
        });

        expect(print?.isAggressorSelling).toBe(false);
        expect(print?.executedAtMs).toBe(Date.parse('2026-09-05T15:32:42.873892Z'));
    });

    it('reads the print replayed when the socket opens, which is one that happened', () => {
        expect(COINBASE_CONNECTOR.readTrades({
            type: 'last_match', side: 'buy', size: '1', price: '2', time: '2026-09-05T15:32:42.873892Z',
        })).toHaveLength(1);
    });

    it('offers no four-hour candle, because the venue serves none', () => {
        const widths = (COINBASE_CONNECTOR.declaration.bars?.rungs ?? []).map((rung) => rung.widthMs);

        expect(widths).not.toContain(4 * 60 * 60_000);
        expect(() => COINBASE_CONNECTOR.planBars({ ...ASKED, widthMs: 4 * 60 * 60_000 })).toThrow(/No venue candle/);
    });
});
