import { describe, expect, it } from 'vitest';
import { findContradictions } from '../../../../src/shared/core/venue-connector.ts';
import { OKX_CONNECTOR } from '../../../../src/shared/venues/okx-connector.ts';

const ASKED = {
    symbol: 'BTC-USDT',
    widthMs: 60_000,
    fromMs: 1_788_618_300_000,
    toMs: 1_788_621_900_000,
    limit: 1_500,
};

/** Two candles, newest first, exactly as the venue sends them. */
const CANDLES = {
    code: '0',
    data: [
        ['1788621840000', '79748.1', '79762.3', '79748', '79760.3', '1.32239145', '105460.5', '105460.5', '1'],
        ['1788621780000', '79736.3', '79748.1', '79736.2', '79748.1', '0.92957437', '74127.9', '74127.9', '1'],
    ],
};

describe('the connector for a venue whose book arrives on its own socket', () => {
    it('declares what it reads and reads what it declares', () => {
        expect(findContradictions(OKX_CONNECTOR)).toEqual([]);
    });

    it('declares no book, and refuses to be asked for one', () => {
        // The venue publishes a good one — every update names the sequence
        // before it — but it publishes the opening ladder on the socket, and a
        // connector describes requests rather than reading streams into being.
        expect(OKX_CONNECTOR.declaration.book).toBeNull();
        expect(() => OKX_CONNECTOR.planSnapshot('BTC-USDT')).toThrow(/no book/);
    });

    it('names the older edge of a window `before` and the newer one `after`', () => {
        // The opposite of how the two words read, and the mistake that answers
        // with an empty page rather than with an error.
        const asked = OKX_CONNECTOR.planBars(ASKED);

        expect(asked.url).toContain('before=1788618300000');
        expect(asked.url).toContain('after=1788621900000');
    });

    it('asks the endpoint that reaches back, not the one that serves today', () => {
        // A connector holds no clock, so it cannot tell a window of last week
        // from one of this hour — and only one of this venue's two endpoints
        // answers for both.
        expect(OKX_CONNECTOR.planBars(ASKED).url).toContain('/history-candles');
    });

    it('hands back a page oldest first, though the venue sends it newest first', () => {
        const page = OKX_CONNECTOR.readBars(CANDLES, ASKED);

        expect(page.map((bar) => bar.openedAtMs)).toEqual([1_788_621_780_000, 1_788_621_840_000]);
        expect(page[0]?.closePrice).toBe(79_748.1);
    });

    it('names a pair by the two currencies rather than by its own id', () => {
        const listed = OKX_CONNECTOR.readInstruments({
            code: '0',
            data: [{ instId: 'BTC-USDT', baseCcy: 'BTC', quoteCcy: 'USDT', tickSz: '0.1', state: 'live' }],
        });

        expect(listed).toEqual([{
            symbol: 'BTC-USDT', base: 'BTC', quote: 'USDT', priceStep: 0.1, isTrading: true,
        }]);
    });

    it('keeps a pair that is listed but not trading, saying so', () => {
        const listed = OKX_CONNECTOR.readInstruments({
            data: [{ instId: 'X-USDT', baseCcy: 'X', quoteCcy: 'USDT', tickSz: '0.1', state: 'suspend' }],
        });

        expect(listed[0]?.isTrading).toBe(false);
    });

    it('reads a print by the side that crossed the spread', () => {
        const [print] = OKX_CONNECTOR.readTrades({
            arg: { channel: 'trades', instId: 'BTC-USDT' },
            data: [{ instId: 'BTC-USDT', tradeId: '1', px: '79720', sz: '0.01243027', side: 'sell', ts: '1788622342189' }],
        });

        expect(print).toEqual({
            executedAtMs: 1_788_622_342_189,
            price: 79_720,
            quantity: 0.01243027,
            isAggressorSelling: true,
        });
    });

    it('says nothing about the venue\'s answer to the subscription itself', () => {
        expect(OKX_CONNECTOR.readTrades({ event: 'subscribe', arg: { channel: 'trades' } })).toEqual([]);
    });
});
