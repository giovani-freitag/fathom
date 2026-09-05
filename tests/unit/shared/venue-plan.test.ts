import { describe, expect, it } from 'vitest';
import { findMissingFacts, readVenueFacts } from '../../../src/shared/core/venue-plan.ts';
import type { VenueDeclaration } from '../../../src/shared/core/venue-plan.ts';

const NOTHING: VenueDeclaration = { book: null, tape: null, bars: null };

const WHOLE_BOOK = {
    grade: 'linked' as const,
    levelsPerSide: 'all' as const,
    publishIntervalMs: 100,
    clock: 'venue' as const,
};

const SIDED_TAPE = { siding: 'sided' as const, clock: 'venue' as const, hasStableIds: true };

const BARS = {
    rungs: [{ widthMs: 60_000, anchorMs: 0 }],
    barsPerRequest: 1_500,
    hasVolume: true,
    hasBuyVolume: false,
    hasTradeCount: true,
};

describe('which facts a venue supplies', () => {
    it('supplies nothing when it publishes nothing', () => {
        expect([...readVenueFacts(NOTHING)]).toEqual([]);
    });

    it('separates a whole ladder from a window onto the nearest few', () => {
        // In a whole ladder an absent price means nothing rests there. In a
        // feed of fifty it means nobody said, and a reading that shades the
        // gaps would be shading a place it was never told about.
        const windowed = { ...NOTHING, book: { ...WHOLE_BOOK, levelsPerSide: 50 } };

        expect([...readVenueFacts(windowed)]).toEqual(['book']);
        expect([...readVenueFacts({ ...NOTHING, book: WHOLE_BOOK })]).toEqual(['book', 'wholeBook']);
    });

    it('reads the taker split off the bars, not off the tape', () => {
        // The correction the whole design turns on: no candle endpoint outside
        // the shipped venue carries a split, so a sided tape buys the readings
        // that compute over bars nothing at all over history.
        const sidedTapePlainBars = { ...NOTHING, tape: SIDED_TAPE, bars: BARS };

        expect([...readVenueFacts(sidedTapePlainBars)]).not.toContain('takerSplit');
    });

    it('grants the split off a sided tape when the bars are folded from it', () => {
        // With no candle endpoint the engine folds history out of the tape, so
        // the split the tape carries is the split the bars end up with.
        const foldedFromTape = { ...NOTHING, tape: SIDED_TAPE, bars: null };

        expect([...readVenueFacts(foldedFromTape)]).toContain('takerSplit');
    });

    it('grants the split off bars that publish it', () => {
        const splitInBars = { ...NOTHING, bars: { ...BARS, hasBuyVolume: true } };

        expect([...readVenueFacts(splitInBars)]).toContain('takerSplit');
    });

    it('separates trading volume from the side that traded it', () => {
        // Summing the two sides is not splitting them: two shipped readings add
        // them for a size and need no split at all, and calling that a split
        // would put them out of reach on every venue but one.
        const sized = { ...NOTHING, bars: BARS };

        expect([...readVenueFacts(sized)]).toContain('volume');
        expect([...readVenueFacts(sized)]).not.toContain('takerSplit');
    });

    it('withholds the size from a venue whose candles carry none', () => {
        const unsized = { ...NOTHING, bars: { ...BARS, hasVolume: false } };

        expect([...readVenueFacts(unsized)]).not.toContain('volume');
    });

    it('withholds the count from a venue whose candles do not carry one', () => {
        // Zero is a real answer everywhere here, so an uncounted venue must not
        // have zero written across its whole history.
        const uncounted = { ...NOTHING, bars: { ...BARS, hasTradeCount: false } };

        expect([...readVenueFacts(uncounted)]).not.toContain('tradeCount');
    });
});

describe('what a reading asked for and did not get', () => {
    it('names the shortfall in the order the reading asked', () => {
        const offered = readVenueFacts({ ...NOTHING, book: WHOLE_BOOK });

        expect(findMissingFacts(['takerSplit', 'book', 'tape'], offered)).toEqual(['takerSplit', 'tape']);
    });

    it('is empty for a reading the venue can answer whole', () => {
        const offered = readVenueFacts({ ...NOTHING, book: WHOLE_BOOK });

        expect(findMissingFacts(['book', 'wholeBook'], offered)).toEqual([]);
    });
});
