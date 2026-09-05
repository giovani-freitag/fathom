import { describe, expect, it } from 'vitest';
import { isAlreadyRecorded, isRecordable, offerGrids } from '../../../../src/app/markets/recordable.ts';

function pair(priceStep: number) {
    return { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', priceStep, isTrading: true };
}

describe('the grids a contract may be recorded on', () => {
    it('is a band of the price rather than a count of ticks', () => {
        // The tick says how finely a price may be written, which on one venue
        // is a hundredth of a per cent of the price and on another a hundred
        // times that. Grids built from it are a different band on every pair.
        const offered = offerGrids(pair(0.1), 80_000);

        expect(offered.map((one) => one.priceBucketSize)).toEqual([5, 20, 100]);
        expect(offered.find((one) => one.isSuggested)?.priceBucketSize).toBe(20);
    });

    it('puts about the same number of rows across any price', () => {
        // A row means the same thing on a pair worth eighty thousand and one
        // worth a tenth, which is what makes the choice readable at all.
        const rich = offerGrids(pair(0.1), 80_000).find((one) => one.isSuggested)!;
        const cheap = offerGrids(pair(0.000001), 0.1).find((one) => one.isSuggested)!;

        // Rounded to numbers people say out loud, so the two land near each
        // other rather than on the same figure.
        for (const rows of [80_000 / rich.priceBucketSize, 0.1 / cheap.priceBucketSize]) {
            expect(rows).toBeGreaterThanOrEqual(2_000);
            expect(rows).toBeLessThanOrEqual(8_000);
        }
    });

    it('is never finer than the smallest move the venue quotes', () => {
        // A row narrower than the tick is a ladder of stripes with nothing
        // between them.
        const offered = offerGrids(pair(0.5), 80);

        expect(Math.min(...offered.map((one) => one.priceBucketSize))).toBeGreaterThanOrEqual(0.5);
    });

    it('falls back to the tick where nothing has said what it trades at', () => {
        expect(offerGrids(pair(0.1), null).map((one) => one.priceBucketSize)).toEqual([2, 10, 50]);
    });

    it('offers none where neither a price nor a tick is known', () => {
        expect(offerGrids(pair(0), null)).toEqual([]);
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
