import { describe, expect, it } from 'vitest';
import { findContradictions } from '../../../../src/shared/core/venue-connector.ts';
import { KRAKEN_CONNECTOR } from '../../../../src/shared/venues/kraken-connector.ts';

const ASKED = {
    symbol: 'XBTUSD',
    widthMs: 60_000,
    fromMs: 1_788_600_000_000,
    toMs: 1_788_600_180_000,
    limit: 720,
};

/** The venue's answer, keyed by its own name for the pair. */
const CANDLES = {
    error: [],
    result: {
        XXBTZUSD: [
            [1_788_600_000, '79700.2', '79703.4', '79700.2', '79703.4', '79701.9', '0.05691898', 35],
            [1_788_600_060, '79703.4', '79704.0', '79702.0', '79702.5', '79703.0', '0.01', 4],
            [1_788_600_240, '79710.0', '79710.0', '79709.0', '79709.5', '79709.5', '0.02', 6],
        ],
        last: 1_788_622_440,
    },
};

describe('the connector for a venue that checks its book with a checksum', () => {
    it('declares what it reads and reads what it declares', () => {
        expect(findContradictions(KRAKEN_CONNECTOR)).toEqual([]);
    });

    it('declares no book, because nothing in an update says where it sits', () => {
        // The mirror joins updates by their numbering. This venue numbers
        // nothing and checks the top ten levels with a checksum instead, so
        // there is nothing to join a run of updates by.
        expect(KRAKEN_CONNECTOR.declaration.book).toBeNull();
    });

    it('reads a listing that is an object of pairs rather than a list of them', () => {
        const listed = KRAKEN_CONNECTOR.readInstruments({
            result: {
                XXBTZUSD: { altname: 'XBTUSD', wsname: 'XBT/USD', status: 'online', pair_decimals: 1 },
            },
        });

        expect(listed).toEqual([{
            symbol: 'XBTUSD', base: 'XBT', quote: 'USD', priceStep: 0.1, isTrading: true,
        }]);
    });

    it('refuses an answer with no pairs in it at all', () => {
        expect(() => KRAKEN_CONNECTOR.readInstruments({ error: ['EGeneral:Invalid'] }))
            .toThrow(/no pairs/);
    });

    it('finds the candles under the venue\'s own name for the pair', () => {
        // Asked by XBTUSD and answered under XXBTZUSD. Looked up by the name it
        // was asked by, every page here is empty.
        const page = KRAKEN_CONNECTOR.readBars(CANDLES, { ...ASKED, toMs: 1_788_600_300_000 });

        expect(page).toHaveLength(3);
        expect(page[0]?.tradeCount).toBe(35);
    });

    it('drops what the venue sent past the window it was asked for', () => {
        // The endpoint takes an opening edge and no closing one, so it answers
        // with everything since — up to seven hundred bars past the question.
        const page = KRAKEN_CONNECTOR.readBars(CANDLES, ASKED);

        expect(page.map((bar) => bar.openedAtMs)).toEqual([1_788_600_000_000, 1_788_600_060_000]);
    });

    it('names the opening edge in seconds, which is the only edge it takes', () => {
        const asked = KRAKEN_CONNECTOR.planBars(ASKED);

        expect(asked.url).toMatch(/since=1788600000(&|$)/);
        expect(asked.url).toContain('interval=1');
    });

    it('reads a print off the stream, with the instant written out as text', () => {
        const [print] = KRAKEN_CONNECTOR.readTrades({
            channel: 'trade',
            type: 'update',
            data: [{
                symbol: 'BTC/USD',
                side: 'sell',
                qty: 0.001,
                price: 79_700,
                ord_type: 'market',
                trade_id: 1,
                timestamp: '2026-09-05T15:32:42.708706Z',
            }],
        });

        expect(print?.isAggressorSelling).toBe(true);
        expect(print?.executedAtMs).toBe(Date.parse('2026-09-05T15:32:42.708706Z'));
    });

    it('says nothing about the heartbeat the venue sends between prints', () => {
        expect(KRAKEN_CONNECTOR.readTrades({ channel: 'heartbeat' })).toEqual([]);
    });
});
