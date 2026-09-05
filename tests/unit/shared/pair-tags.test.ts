import { describe, expect, it } from 'vitest';
import {
    FAVOURITES_ID,
    findTagsHolding,
    MAXIMUM_TAGS,
    MAXIMUM_PAIRS_PER_TAG,
    openingTags,
    readTags,
    withTagAdded,
    withTagRemoved,
    withTagRelabelled,
    withPairTagged,
    withPairUntagged,
    withTagRecoloured,
} from '../../../src/shared/core/pair-tags.ts';
import { INSTANCE_TONES } from '../../../src/shared/core/draw-plan.ts';

const BTC = { venue: 'binance-futures', symbol: 'BTCUSDT' };
const NANO = { venue: 'binance-futures', symbol: 'NANOUSDT' };

describe('the tags a reader starts with', () => {
    it('is one, empty, that cannot be taken away', () => {
        const tags = openingTags();

        expect(tags).toHaveLength(1);
        expect(withTagRemoved(tags, FAVOURITES_ID)).toHaveLength(1);
    });

    it('leaves its label to the interface rather than storing one', () => {
        // A name written into storage in English stays English after the reader
        // changes languages.
        expect(openingTags()[0]?.label).toBe('');
    });
});

describe('filing a pair under a tag', () => {
    it('keeps the order the reader added them in', () => {
        const tags = withPairTagged(withPairTagged(openingTags(), FAVOURITES_ID, BTC), FAVOURITES_ID, NANO);

        expect(tags[0]?.pairs).toEqual([BTC, NANO]);
    });

    it('changes nothing when the tag already holds it', () => {
        const once = withPairTagged(openingTags(), FAVOURITES_ID, BTC);

        expect(withPairTagged(once, FAVOURITES_ID, BTC)[0]?.pairs).toHaveLength(1);
    });

    it('tells the same symbol on two venues apart', () => {
        // Two venues, two recordings, two histories. A tag holding only the
        // symbol would open whichever the chart found first.
        const tags = withPairTagged(
            withPairTagged(openingTags(), FAVOURITES_ID, BTC),
            FAVOURITES_ID,
            { venue: 'kucoin', symbol: 'BTCUSDT' },
        );

        expect(tags[0]?.pairs).toHaveLength(2);
    });

    it('stops at as many as the chart will offer to switch between', () => {
        let tags = openingTags();
        for (let index = 0; index <= MAXIMUM_PAIRS_PER_TAG; index += 1) {
            tags = withPairTagged(tags, FAVOURITES_ID, { venue: 'binance-futures', symbol: `P${String(index)}` });
        }

        expect(tags[0]?.pairs).toHaveLength(MAXIMUM_PAIRS_PER_TAG);
    });

    it('leaves every other tag alone', () => {
        const withTwo = withTagAdded(openingTags(), 'Shitcoins');

        const tags = withPairTagged(withTwo, FAVOURITES_ID, BTC);

        expect(tags[1]?.pairs).toEqual([]);
    });
});

describe('taking a pair out', () => {
    it('leaves the rest of the tag in order', () => {
        const held = withPairTagged(withPairTagged(openingTags(), FAVOURITES_ID, BTC), FAVOURITES_ID, NANO);

        expect(withPairUntagged(held, FAVOURITES_ID, BTC)[0]?.pairs).toEqual([NANO]);
    });

    it('leaves the same pair under the other tags it carries', () => {
        let tags = withTagAdded(openingTags(), 'Shitcoins');
        tags = withPairTagged(withPairTagged(tags, FAVOURITES_ID, BTC), tags[1]!.id, BTC);

        const left = findTagsHolding(withPairUntagged(tags, FAVOURITES_ID, BTC), BTC);

        expect(left.map((tag) => tag.id)).toEqual([tags[1]!.id]);
    });
});

describe('making a tag', () => {
    it('gives it an id nothing else answers to', () => {
        const tags = withTagAdded(withTagAdded(openingTags(), 'Shitcoins'), 'Shitcoins');

        expect(new Set(tags.map((tag) => tag.id)).size).toBe(3);
    });

    it('never gives one the first tag\'s id, whatever it is called', () => {
        const tags = withTagAdded(openingTags(), 'Favourites');

        expect(tags[1]?.id).not.toBe(FAVOURITES_ID);
        expect(tags).toHaveLength(2);
    });

    it('gives a label with nothing to make an id from one anyway', () => {
        const tags = withTagAdded(openingTags(), '★★★');

        expect(tags[1]?.id).not.toBe('');
        expect(tags[1]?.label).toBe('★★★');
    });

    it('refuses a label that is only spaces', () => {
        expect(withTagAdded(openingTags(), '   ')).toHaveLength(1);
    });

    it('stops at as many as a reader can find their way around', () => {
        let tags = openingTags();
        for (let index = 0; index <= MAXIMUM_TAGS; index += 1) {
            tags = withTagAdded(tags, `Tag ${String(index)}`);
        }

        expect(tags).toHaveLength(MAXIMUM_TAGS);
    });
});

describe('relabelling a tag', () => {
    it('changes the label and nothing else', () => {
        const tags = withTagRelabelled(withTagAdded(openingTags(), 'Shitcons'), 'shitcons', 'Shitcoins');

        expect(tags[1]?.label).toBe('Shitcoins');
        expect(tags[1]?.id).toBe('shitcons');
    });

    it('refuses an empty label rather than leaving a tag nothing names', () => {
        const named = withTagAdded(openingTags(), 'Shitcoins');

        expect(withTagRelabelled(named, 'shitcoins', '  ')[1]?.label).toBe('Shitcoins');
    });
});

describe('the colour a tag is marked in', () => {
    it('hands each new tag one no other tag is using', () => {
        let tags = openingTags();
        for (const label of ['Shitcoins', 'Majors', 'Morning']) {
            tags = withTagAdded(tags, label);
        }

        expect(new Set(tags.map((tag) => tag.colour)).size).toBe(tags.length);
    });

    it('comes back round once every colour in the rotation is taken', () => {
        // The rotation is what a tag is *given*; a reader who wants a sixth
        // colour names one, which is the next test.
        let tags = openingTags();
        for (let index = 0; index < INSTANCE_TONES.length; index += 1) {
            tags = withTagAdded(tags, `Tag ${String(index)}`);
        }

        expect(new Set(tags.map((tag) => tag.colour)).size).toBe(INSTANCE_TONES.length);
    });

    it('takes any colour a reader names, because tags outnumber the palette', () => {
        const tags = withTagRecoloured(withTagAdded(openingTags(), 'Shitcoins'), 'shitcoins', '#ff8800');

        expect(tags[1]?.colour).toBe('#ff8800');
    });

    it('keeps one of the chart\'s own as a token, so it follows the theme', () => {
        // Written as a colour it would be right on one ground and wrong on the
        // other: the palette resolves differently in the light theme.
        const tags = withTagRecoloured(withTagAdded(openingTags(), 'Shitcoins'), 'shitcoins', 'cyan');

        expect(tags[1]?.colour).toBe('cyan');
    });

    it('refuses one that is not a colour at all', () => {
        // A tag's colour reaches a style attribute, and a tag coloured with a
        // sentence is a sentence in the page's own CSS.
        const named = withTagAdded(openingTags(), 'Shitcoins');

        const tags = withTagRecoloured(named, 'shitcoins', 'red; content: bad' as never);

        expect(tags[1]?.colour).toBe(named[1]?.colour);
    });

    it('is changed on the one asked for and no other', () => {
        const tags = withTagRecoloured(withTagAdded(openingTags(), 'Shitcoins'), 'shitcoins', 'cyan');

        expect(tags[1]?.colour).toBe('cyan');
        expect(tags[0]?.colour).toBe(openingTags()[0]?.colour);
    });
});

describe('reading tags back out of storage', () => {
    it('keeps what a reader saved', () => {
        const saved = [{ id: FAVOURITES_ID, label: '', colour: '#ff8800', pairs: [BTC] }];

        expect(readTags(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    });

    it('reads a tag kept before a reader could name its colour', () => {
        const tags = readTags([{ id: FAVOURITES_ID, label: '', tone: 'violet', pairs: [] }]);

        expect(tags[0]?.colour).toBe('violet');
    });

    it('reads a list a reader kept before tags as the tag it became', () => {
        // The two differ by a colour and a word. Dropping the older shape would
        // drop every pair anybody had kept.
        const tags = readTags([{ id: FAVOURITES_ID, name: 'Favourites', pairs: [BTC] }]);

        expect(tags[0]?.label).toBe('Favourites');
        expect(tags[0]?.pairs).toEqual([BTC]);
    });

    it('marks a stored tag with no colour in one nothing else is using', () => {
        const tags = readTags([
            { id: FAVOURITES_ID, name: '', pairs: [] },
            { id: 'shitcoins', name: 'Shitcoins', pairs: [] },
        ]);

        expect(new Set(tags.map((tag) => tag.colour)).size).toBe(2);
    });

    it('refuses a colour that is neither the chart\'s nor one that can be shown', () => {
        // Storage is a file a reader can edit, and what it holds is written
        // into a style attribute.
        const tags = readTags([{ id: FAVOURITES_ID, label: '', colour: 'chartreuse', pairs: [] }]);

        expect(INSTANCE_TONES).toContain(tags[0]?.colour);
    });

    it('answers with the opening set when storage held something else', () => {
        expect(readTags('nonsense')).toEqual(openingTags());
        expect(readTags(null)).toEqual(openingTags());
    });

    it('drops a pair that is not one rather than taking the picker down', () => {
        // Storage is a file the reader can edit, and a tag whose pairs are not
        // pairs throws on the first render that walks it.
        const tags = readTags([{ id: FAVOURITES_ID, label: '', pairs: [BTC, { venue: 'kucoin' }, 7] }]);

        expect(tags[0]?.pairs).toEqual([BTC]);
    });

    it('puts the first tag back when storage has lost it', () => {
        const tags = readTags([{ id: 'shitcoins', label: 'Shitcoins', pairs: [] }]);

        expect(tags[0]?.id).toBe(FAVOURITES_ID);
        expect(tags).toHaveLength(2);
    });
});
