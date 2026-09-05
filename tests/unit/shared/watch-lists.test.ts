import { describe, expect, it } from 'vitest';
import {
    FAVOURITES_ID,
    findListsHolding,
    MAXIMUM_LISTS,
    MAXIMUM_PAIRS_PER_LIST,
    openingLists,
    readLists,
    withListAdded,
    withListRemoved,
    withListRenamed,
    withPairAdded,
    withPairRemoved,
} from '../../../src/shared/core/watch-lists.ts';

const BTC = { venue: 'binance-futures', symbol: 'BTCUSDT' };
const NANO = { venue: 'binance-futures', symbol: 'NANOUSDT' };

describe('the lists a reader starts with', () => {
    it('is one, empty, that cannot be taken away', () => {
        const lists = openingLists();

        expect(lists).toHaveLength(1);
        expect(withListRemoved(lists, FAVOURITES_ID)).toHaveLength(1);
    });

    it('leaves its name to the interface rather than storing one', () => {
        // A name written into storage in English stays English after the reader
        // changes languages.
        expect(openingLists()[0]?.name).toBe('');
    });
});

describe('putting a pair in a list', () => {
    it('keeps the order the reader added them in', () => {
        const lists = withPairAdded(withPairAdded(openingLists(), FAVOURITES_ID, BTC), FAVOURITES_ID, NANO);

        expect(lists[0]?.pairs).toEqual([BTC, NANO]);
    });

    it('changes nothing when the list already holds it', () => {
        const once = withPairAdded(openingLists(), FAVOURITES_ID, BTC);

        expect(withPairAdded(once, FAVOURITES_ID, BTC)[0]?.pairs).toHaveLength(1);
    });

    it('tells the same symbol on two venues apart', () => {
        // Two venues, two recordings, two histories. A list holding only the
        // symbol would open whichever the chart found first.
        const lists = withPairAdded(
            withPairAdded(openingLists(), FAVOURITES_ID, BTC),
            FAVOURITES_ID,
            { venue: 'kucoin', symbol: 'BTCUSDT' },
        );

        expect(lists[0]?.pairs).toHaveLength(2);
    });

    it('stops at as many as the chart will offer to switch between', () => {
        let lists = openingLists();
        for (let index = 0; index <= MAXIMUM_PAIRS_PER_LIST; index += 1) {
            lists = withPairAdded(lists, FAVOURITES_ID, { venue: 'binance-futures', symbol: `P${String(index)}` });
        }

        expect(lists[0]?.pairs).toHaveLength(MAXIMUM_PAIRS_PER_LIST);
    });

    it('leaves every other list alone', () => {
        const withTwo = withListAdded(openingLists(), 'Shitcoins');

        const lists = withPairAdded(withTwo, FAVOURITES_ID, BTC);

        expect(lists[1]?.pairs).toEqual([]);
    });
});

describe('taking a pair out', () => {
    it('leaves the rest of the list in order', () => {
        const held = withPairAdded(withPairAdded(openingLists(), FAVOURITES_ID, BTC), FAVOURITES_ID, NANO);

        expect(withPairRemoved(held, FAVOURITES_ID, BTC)[0]?.pairs).toEqual([NANO]);
    });

    it('leaves the same pair in the other lists it is in', () => {
        let lists = withListAdded(openingLists(), 'Shitcoins');
        lists = withPairAdded(withPairAdded(lists, FAVOURITES_ID, BTC), lists[1]!.id, BTC);

        expect(findListsHolding(withPairRemoved(lists, FAVOURITES_ID, BTC), BTC)).toEqual([lists[1]!.id]);
    });
});

describe('making a list', () => {
    it('gives it an id nothing else answers to', () => {
        const lists = withListAdded(withListAdded(openingLists(), 'Shitcoins'), 'Shitcoins');

        expect(new Set(lists.map((list) => list.id)).size).toBe(3);
    });

    it('never gives one the first list\'s id, whatever it is called', () => {
        const lists = withListAdded(openingLists(), 'Favourites');

        expect(lists[1]?.id).not.toBe(FAVOURITES_ID);
        expect(lists).toHaveLength(2);
    });

    it('gives a name with nothing to make an id from one anyway', () => {
        const lists = withListAdded(openingLists(), '★★★');

        expect(lists[1]?.id).not.toBe('');
        expect(lists[1]?.name).toBe('★★★');
    });

    it('refuses a name that is only spaces', () => {
        expect(withListAdded(openingLists(), '   ')).toHaveLength(1);
    });

    it('stops at as many as a reader can find their way around', () => {
        let lists = openingLists();
        for (let index = 0; index <= MAXIMUM_LISTS; index += 1) {
            lists = withListAdded(lists, `List ${String(index)}`);
        }

        expect(lists).toHaveLength(MAXIMUM_LISTS);
    });
});

describe('renaming a list', () => {
    it('changes the name and nothing else', () => {
        const lists = withListRenamed(withListAdded(openingLists(), 'Shitcons'), 'shitcons', 'Shitcoins');

        expect(lists[1]?.name).toBe('Shitcoins');
        expect(lists[1]?.id).toBe('shitcons');
    });

    it('refuses an empty name rather than leaving a list nothing names', () => {
        const named = withListAdded(openingLists(), 'Shitcoins');

        expect(withListRenamed(named, 'shitcoins', '  ')[1]?.name).toBe('Shitcoins');
    });
});

describe('reading lists back out of storage', () => {
    it('keeps what a reader saved', () => {
        const saved = [{ id: FAVOURITES_ID, name: '', pairs: [BTC] }];

        expect(readLists(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    });

    it('answers with the opening set when storage held something else', () => {
        expect(readLists('nonsense')).toEqual(openingLists());
        expect(readLists(null)).toEqual(openingLists());
    });

    it('drops a pair that is not one rather than taking the picker down', () => {
        // Storage is a file the reader can edit, and a list whose pairs are not
        // pairs throws on the first render that walks it.
        const lists = readLists([{ id: FAVOURITES_ID, name: '', pairs: [BTC, { venue: 'kucoin' }, 7] }]);

        expect(lists[0]?.pairs).toEqual([BTC]);
    });

    it('puts the first list back when storage has lost it', () => {
        const lists = readLists([{ id: 'shitcoins', name: 'Shitcoins', pairs: [] }]);

        expect(lists[0]?.id).toBe(FAVOURITES_ID);
        expect(lists).toHaveLength(2);
    });
});
