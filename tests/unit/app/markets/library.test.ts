import { describe, expect, it } from 'vitest';
import { gatherLibrary, narrowLibrary } from '../../../../src/app/markets/library.ts';
import type { PairTag } from '../../../../src/shared/core/pair-tags.ts';

const BTC = { venue: 'binance-futures', symbol: 'BTCUSDT' };
const ETH = { venue: 'binance-futures', symbol: 'ETHUSDT' };
const SOL = { venue: 'bybit', symbol: 'SOLUSDT' };

function tag(id: string, pairs: readonly { venue: string; symbol: string }[]): PairTag {
    return { id, label: id, colour: 'phosphor', pairs };
}

describe('the pairs a reader has a claim on', () => {
    it('gathers what is recorded, what is tagged and what is open', () => {
        const rows = gatherLibrary([BTC], [tag('fav', [SOL])], ETH);

        expect(rows.map((row) => row.pair.symbol).sort()).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    });

    it('lists a pair once however many claims it carries', () => {
        // Recorded and tagged is one pair. Listed under both it is the same row
        // asking to be read twice.
        const rows = gatherLibrary([BTC], [tag('fav', [BTC]), tag('majors', [BTC])], BTC);

        expect(rows).toHaveLength(1);
        expect([...rows[0]!.held].sort()).toEqual(['fav', 'majors']);
        expect(rows[0]!.isRecorded).toBe(true);
    });

    it('puts what draws above what does not', () => {
        const rows = gatherLibrary([SOL], [tag('fav', [BTC])], null);

        expect(rows[0]?.pair.symbol).toBe('SOLUSDT');
    });

    it('tells the same symbol on two venues apart', () => {
        const rows = gatherLibrary([BTC], [tag('fav', [{ venue: 'bybit', symbol: 'BTCUSDT' }])], null);

        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.pair.venue).sort()).toEqual(['binance-futures', 'bybit']);
    });

    it('is empty for a reader who has nothing yet', () => {
        expect(gatherLibrary([], [], null)).toEqual([]);
    });
});

describe('narrowing the library by a chip', () => {
    const rows = gatherLibrary([BTC], [tag('fav', [SOL])], null);

    it('keeps everything under All', () => {
        expect(narrowLibrary(rows, { kind: 'all' })).toHaveLength(2);
    });

    it('keeps what draws under Recording', () => {
        expect(narrowLibrary(rows, { kind: 'recording' }).map((row) => row.pair.symbol))
            .toEqual(['BTCUSDT']);
    });

    it('keeps what a tag holds under that tag', () => {
        expect(narrowLibrary(rows, { kind: 'tag', tagId: 'fav' }).map((row) => row.pair.symbol))
            .toEqual(['SOLUSDT']);
    });
});
