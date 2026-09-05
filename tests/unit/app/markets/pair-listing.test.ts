import { describe, expect, it } from 'vitest';
import {
    narrowPairs,
    QUOTES_OFFERED,
    ROWS_SHOWN,
    summariseQuotes,
} from '../../../../src/app/markets/pair-listing.ts';
import type { VenueInstrument } from '../../../../src/shared/core/venue-connector.ts';

function pair(symbol: string, base: string, quote: string): VenueInstrument {
    return { symbol, base, quote, priceStep: 0.1, isTrading: true };
}

const LISTING = [
    pair('BTCUSDT', 'BTC', 'USDT'),
    pair('ETHUSDT', 'ETH', 'USDT'),
    pair('SOLUSDT', 'SOL', 'USDT'),
    pair('BTCUSDC', 'BTC', 'USDC'),
    pair('ETHBTC', 'ETH', 'BTC'),
];

describe('the quote currencies worth offering', () => {
    it('puts the widest first, not the alphabetically first', () => {
        // A venue lists three hundred against its own stablecoin and four
        // against a currency nobody uses; alphabetical puts the four first.
        // USDT quotes three; the other two quote one each and fall back to name.
        expect(summariseQuotes(LISTING)).toEqual(['USDT', 'BTC', 'USDC']);
    });

    it('settles a tie by name, so the row does not reshuffle between reads', () => {
        expect(summariseQuotes([pair('AB', 'A', 'ZZZ'), pair('CD', 'C', 'AAA')]))
            .toEqual(['AAA', 'ZZZ']);
    });

    it('offers no more than a row of them', () => {
        const wide = Array.from({ length: 20 }, (_one, index) => pair(`P${String(index)}`, 'P', `Q${String(index)}`));

        expect(summariseQuotes(wide)).toHaveLength(QUOTES_OFFERED);
    });

    it('leaves out a quote too thin to be worth a slot', () => {
        // The shipped venue quotes eight hundred and fifty against one currency
        // and two against another. A chip that narrows nine hundred rows to two
        // is a slot spent, and typing reaches those two anyway.
        const lopsided = [
            ...Array.from({ length: 400 }, (_one, index) => pair(`P${String(index)}`, 'P', 'USDT')),
            pair('ODD', 'ODD', 'U'),
        ];

        expect(summariseQuotes(lopsided)).toEqual(['USDT']);
    });

    it('offers none for a listing that has not arrived', () => {
        expect(summariseQuotes([])).toEqual([]);
    });
});

describe('narrowing a listing', () => {
    it('matches the symbol, the base or the quote', () => {
        expect(narrowPairs(LISTING, { query: 'sol', quote: '' }).shown.map((one) => one.symbol))
            .toEqual(['SOLUSDT']);
        expect(narrowPairs(LISTING, { query: 'usdc', quote: '' }).shown.map((one) => one.symbol))
            .toEqual(['BTCUSDC']);
    });

    it('keeps the venue\'s own order, which is how it ranks them', () => {
        expect(narrowPairs(LISTING, { query: '', quote: 'USDT' }).shown.map((one) => one.symbol))
            .toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    });

    it('reads a quote chip and a search together, not one or the other', () => {
        expect(narrowPairs(LISTING, { query: 'BTC', quote: 'USDT' }).shown.map((one) => one.symbol))
            .toEqual(['BTCUSDT']);
    });

    it('hands back everything on an empty filter', () => {
        expect(narrowPairs(LISTING, { query: '  ', quote: '' }).matched).toBe(5);
    });

    it('says how many matched, not only how many fitted', () => {
        // The count is what tells a reader to narrow rather than to scroll, so
        // it counts the match and not the screenful.
        const wide = Array.from({ length: ROWS_SHOWN + 40 }, (_one, index) => pair(`P${String(index)}`, 'P', 'USDT'));

        const narrowed = narrowPairs(wide, { query: '', quote: '' });

        expect(narrowed.shown).toHaveLength(ROWS_SHOWN);
        expect(narrowed.matched).toBe(ROWS_SHOWN + 40);
    });
});
