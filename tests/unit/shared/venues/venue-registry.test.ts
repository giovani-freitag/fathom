import { afterEach, describe, expect, it } from 'vitest';
import {
    forgetConnector,
    isLegalConnectorId,
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
