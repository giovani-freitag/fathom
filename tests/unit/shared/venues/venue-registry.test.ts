import { afterEach, describe, expect, it } from 'vitest';
import {
    forgetConnector,
    readMarkFor,
    isLegalConnectorId,
    isShippedVenue,
    listConnectors,
    readFactsFor,
    registerConnector,
} from '../../../../src/shared/venues/venue-registry.ts';
import { FIRST_VENUE } from '../../../../src/shared/core/recording-control.ts';
import { buildConnector } from '../../../mocks/venue-connectors.ts';

const BOOK_ONLY = buildConnector({
    book: { grade: 'stepped', levelsPerSide: 50, publishIntervalMs: 100, clock: 'venue' },
    tape: null,
    bars: null,
});

afterEach(() => { forgetConnector('kucoin'); });

describe('the connectors the chart can reach', () => {
    it('ships knowing the venue every recording came from', () => {
        expect(listConnectors().map(([id]) => id)).toContain(FIRST_VENUE);
    });

    it('takes one a reader wrote', () => {
        registerConnector('kucoin', BOOK_ONLY);

        expect(listConnectors().map(([id]) => id)).toContain('kucoin');
    });

    it('takes the pacing a connector asks for, and refuses one that counts nothing', () => {
        // A listing capped at nought pages fetches nothing, and the reader finds
        // out when the chart stays empty rather than when the file was written.
        expect(() => registerConnector('paced', Object.assign(buildConnector({
            book: null, tape: null, bars: null,
        }), { pacing: { pagesPerListing: 60, requestsAtOnce: 2 } }))).not.toThrow();
        expect(() => registerConnector('unpaced', Object.assign(buildConnector({
            book: null, tape: null, bars: null,
        }), { pacing: { pagesPerListing: 0, requestsAtOnce: 2 } }))).toThrow(/not a count/);
    });

    it('refuses a pacing past what the engine will perform', () => {
        // Not a second opinion on the venue's rate limit, which the connector
        // knows better: a guard against the typo that gets a reader's own
        // address refused before they can read the error.
        expect(() => registerConnector('greedy', Object.assign(buildConnector({
            book: null, tape: null, bars: null,
        }), { pacing: { pagesPerListing: 20, requestsAtOnce: 5_000 } }))).toThrow(/past the/);
    });

    it('refuses a name that could be read as the shipped venue', () => {
        // A recording filed under the wrong venue cannot be filed again, and the
        // venue is half the key every row is now written under.
        expect(() => registerConnector(FIRST_VENUE, BOOK_ONLY)).toThrow(/ships with/);
    });

    it('refuses a name that could be read two ways', () => {
        expect(() => registerConnector('KuCoin Futures', BOOK_ONLY)).toThrow(/cannot be/);
    });

    it('will not let the shipped venue be forgotten out from under the recording', () => {
        forgetConnector(FIRST_VENUE);

        expect(listConnectors().map(([id]) => id)).toContain(FIRST_VENUE);
    });
});

describe('what a venue supplies', () => {
    it('is read from what its connector declared', () => {
        registerConnector('kucoin', BOOK_ONLY);

        expect([...readFactsFor('kucoin')]).toEqual(['book']);
    });

    it('is nothing at all for a venue no connector was registered for', () => {
        // Nothing rather than everything: an unknown venue is one whose script
        // has not run, and offering every layer against it draws five of them
        // flat over an absence.
        expect([...readFactsFor('never-registered')]).toEqual([]);
    });
});

describe('what may be a connector name', () => {
    it('takes lowercase words joined by hyphens', () => {
        expect(isLegalConnectorId('kucoin-futures')).toBe(true);
    });

    it('refuses a name holding a slash, which is a path', () => {
        expect(isLegalConnectorId('kucoin/futures')).toBe(false);
    });

    it('refuses a single letter, which names nothing', () => {
        expect(isLegalConnectorId('k')).toBe(false);
    });
});

describe('the mark a venue is drawn with', () => {
    it('guesses nothing from the host the venue answers on', () => {
        // It used to guess `/favicon.ico` there, which named the API host — and
        // an API host serves no mark for most venues. The guess failed for five
        // of the six shipped, failed silently, and so nobody went looking for
        // the address that would have worked.
        registerConnector('unmarked', Object.assign(buildConnector({
            book: null, tape: null, bars: null,
        }), { planInstruments: () => ({ url: 'https://api.example.test/v1/pairs?from=0' }) }));

        expect(readMarkFor('unmarked')).toBeNull();
    });

    it('every shipped venue names one, because a letter is the reader-brought case', () => {
        // A connector added to the build without one draws a letter for ever,
        // and nothing fails to say so.
        const shipped = listConnectors()
            .map(([id]) => id)
            .filter((id) => isShippedVenue(id));

        expect(shipped.filter((id) => readMarkFor(id) === null)).toEqual([]);
    });

    it('takes the address a connector named', () => {
        registerConnector('named', Object.assign(buildConnector({
            book: null, tape: null, bars: null,
        }), {
            planInstruments: () => ({ url: 'https://api.example.test/v1/pairs' }),
            markUrl: 'https://brand.example.test/mark.svg',
        }));

        expect(readMarkFor('named')).toBe('https://brand.example.test/mark.svg');
    });

    it('says nothing for a venue nobody registered', () => {
        expect(readMarkFor('never-heard-of-it')).toBeNull();
    });
});
