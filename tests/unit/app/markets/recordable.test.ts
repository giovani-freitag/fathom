import { describe, expect, it } from 'vitest';
import { isAlreadyRecorded, isRecordable, offerGrids } from '../../../../src/app/markets/recordable.ts';

function pair(priceStep: number) {
    return { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', priceStep, isTrading: true };
}

describe('the grids a new contract may be recorded on', () => {
    it('offers three, built out of the one figure a listing carries', () => {
        // A venue says what it quotes in, not what it trades at.
        const offered = offerGrids(pair(0.1));

        expect(offered.map((one) => one.priceBucketSize)).toEqual([1, 10, 100]);
    });

    it('rounds to a number people say out loud', () => {
        // A grid of 0.037 rules an axis nobody can read at a glance.
        expect(offerGrids(pair(0.0037)).map((one) => one.priceBucketSize)).toEqual([0.05, 0.5, 5]);
    });

    it('offers none where the venue published no tick', () => {
        // Zero is how a connector says it does not know, and a grid of nothing
        // is a heat map of one row.
        expect(offerGrids(pair(0))).toEqual([]);
    });
});

describe('which venues can be recorded', () => {
    it('is the ones that publish a book, because the book is the recording', () => {
        expect(isRecordable({ book: { grade: 'linked' } })).toBe(true);
        expect(isRecordable({ book: null })).toBe(false);
    });
});

describe('what is already being recorded', () => {
    it('tells the same symbol on two venues apart', () => {
        // Two venues both list BTCUSDT, and read by the symbol alone the second
        // one can never be added.
        const contracts = [{
            venue: 'binance-futures',
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            frameIntervalMs: 1_000,
            isEnabled: true,
        }];

        expect(isAlreadyRecorded(contracts, 'binance-futures', 'BTCUSDT')).toBe(true);
        expect(isAlreadyRecorded(contracts, 'bybit', 'BTCUSDT')).toBe(false);
    });
});
