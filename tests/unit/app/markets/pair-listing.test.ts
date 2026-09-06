import { describe, expect, it } from 'vitest';
import {
    narrowPairs,
    searchAcross,
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

describe('what a search puts first', () => {
    /** A listing shaped the way a venue quoting everything in one asset is. */
    function listing(): VenueInstrument[] {
        return [
            pair('LTC_BTC', 'LTC', 'BTC'),
            pair('DOGE_BTC', 'DOGE', 'BTC'),
            pair('BTC3L_USDT', 'BTC3L', 'USDT'),
            pair('BTC_USDT', 'BTC', 'USDT'),
        ];
    }

    it('puts the asset that was named ahead of every pair quoted in it', () => {
        // Typing `btc` on a venue with two thousand pairs matches every pair
        // quoted in it, and the one the reader meant sat thirteenth.
        const found = narrowPairs(listing(), { query: 'btc', quote: '' });

        expect(found.shown[0]?.symbol).toBe('BTC_USDT');
    });

    it('puts a name that begins with it ahead of one that merely contains it', () => {
        // And where two rank the same — both quoted in what was typed — by
        // their own names, so the order does not depend on the venue's.
        const found = narrowPairs(listing(), { query: 'btc', quote: '' });

        expect(found.shown.map((one) => one.symbol))
            .toEqual(['BTC_USDT', 'BTC3L_USDT', 'DOGE_BTC', 'LTC_BTC']);
    });

    it('leaves an unsearched listing in the venue\'s own order', () => {
        // A venue opens on what it is known for; sorted, it opens on a
        // leveraged token whose name happens to start with a digit.
        const found = narrowPairs(listing(), { query: '  ', quote: '' });

        expect(found.shown.map((one) => one.symbol)).toEqual(listing().map((one) => one.symbol));
    });
});

describe('a row the cut may not drop', () => {
    function listing(count: number) {
        return Array.from({ length: count }, (_, at) => ({
            symbol: `P${String(at).padStart(4, '0')}USDT`,
            base: `P${String(at)}`,
            quote: 'USDT',
            priceStep: 0.1,
            isTrading: true,
        }));
    }

    it('draws a pinned pair even when the listing is cut long before it', () => {
        // A venue lists nine hundred pairs and the listing stops at a hundred
        // and fifty. A pair this chart is recording sat outside the cut and
        // could be reached only by typing a name the reader had no way to know
        // was there — and a recording nobody can see is one nobody can stop.
        const pairs = listing(900);
        const late = pairs[800]!.symbol;

        const narrowed = narrowPairs(pairs, { query: '', quote: '', keep: new Set([late]) });

        expect(narrowed.shown[0]?.symbol).toBe(late);
        expect(narrowed.shown).toHaveLength(150);
    });

    it('leaves the order alone when nothing is pinned', () => {
        const pairs = listing(400);

        const narrowed = narrowPairs(pairs, { query: '', quote: '' });

        expect(narrowed.shown[0]?.symbol).toBe(pairs[0]!.symbol);
    });

    it('still ranks the search, with the pinned pair ahead of it', () => {
        const pairs = listing(900);
        const late = pairs[800]!.symbol;

        const narrowed = narrowPairs(pairs, { query: 'USDT', quote: '', keep: new Set([late]) });

        expect(narrowed.shown[0]?.symbol).toBe(late);
        expect(narrowed.matched).toBe(900);
    });
});

describe('a search that is not about one venue', () => {
    function pair(symbol: string, quote = 'USDT') {
        return { symbol, base: symbol.replace(quote, ''), quote, priceStep: 0.1, isTrading: true };
    }

    it('finds a pair on whichever venue happens to hold it', () => {
        // A reader who knows the ticker knows the ticker. Making them name the
        // catalogue first is asking them to answer a question in order to ask
        // their own.
        const found = searchAcross({
            'binance-futures': [pair('BTCUSDT'), pair('ETHUSDT')],
            bybit: [pair('SOLUSDT')],
        }, { query: 'sol', quote: '' });

        expect(found.shown.map((one) => `${one.venue}/${one.instrument.symbol}`)).toEqual(['bybit/SOLUSDT']);
    });

    it('ranks across the venues, not merely within each', () => {
        // Each listing is ranked on its own, so an exact match on the second
        // venue read has to be lifted above a looser one on the first.
        const found = searchAcross({
            'binance-futures': [pair('SOLANAUSDT')],
            bybit: [pair('SOLUSDT')],
        }, { query: 'SOLUSDT', quote: '' });

        expect(found.shown[0]?.venue).toBe('bybit');
    });

    it('counts what matched everywhere, not what fitted', () => {
        const many = Array.from({ length: 200 }, (_, at) => pair(`P${String(at)}USDT`));
        const found = searchAcross({ a: many, b: many }, { query: 'USDT', quote: '' });

        expect(found.matched).toBe(400);
        expect(found.shown.length).toBeLessThanOrEqual(150);
    });

    it('says nothing about a venue nobody has opened', () => {
        const found = searchAcross({}, { query: 'btc', quote: '' });

        expect(found.shown).toEqual([]);
        expect(found.matched).toBe(0);
    });
});
