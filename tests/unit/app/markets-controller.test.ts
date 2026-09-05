import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketsController } from '../../../src/app/core/markets-controller.ts';
import { PreferencesService } from '../../../src/app/services/preferences-service.ts';
import { VenueGateway } from '../../../src/shared/venues/venue-gateway.ts';
import { FAVOURITES_ID } from '../../../src/shared/core/pair-tags.ts';
import { FIRST_VENUE } from '../../../src/shared/core/recording-control.ts';
import { forgetConnector } from '../../../src/shared/venues/venue-registry.ts';
import { buildConnector } from '../../mocks/venue-connectors.ts';

const NOW_MS = 1_700_000_000_000;

/** A connector's files, as the editor hands them over: every one, not just the entry. */
const SOURCE = { 'main.ts': 'exports.default = {};', 'reading/parse.ts': 'exports.read = () => [];' };
const BTC = { venue: FIRST_VENUE, symbol: 'BTCUSDT' };

/** A storage that keeps what it was given, the way a browser's does. */
function buildStorage(): Storage {
    const held = new Map<string, string>();
    return {
        getItem: (key: string) => held.get(key) ?? null,
        setItem: (key: string, value: string) => { held.set(key, value); },
        removeItem: (key: string) => { held.delete(key); },
        clear: () => { held.clear(); },
        key: () => null,
        get length() { return held.size; },
    };
}

function buildController(fetch: typeof globalThis.fetch, storage = buildStorage()): MarketsController {
    return new MarketsController({
        preferences: new PreferencesService({ storage }),
        gateway: new VenueGateway({ fetch }),
        readNowMs: () => NOW_MS,
    });
}

function answerWith(body: unknown): typeof globalThis.fetch {
    return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body))));
}

const EXCHANGE_INFO = {
    symbols: [{
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING',
        filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.1' }],
    }],
};

afterEach(() => { forgetConnector('kucoin'); });

describe('the tags a reader keeps', () => {
    it('opens on the one every reader starts with', () => {
        const markets = buildController(answerWith(EXCHANGE_INFO));

        expect(markets.store.read().openTagId).toBe(FAVOURITES_ID);
    });

    it('survives the page being closed', () => {
        const storage = buildStorage();
        buildController(answerWith(EXCHANGE_INFO), storage).tagPair(FAVOURITES_ID, BTC);

        const reopened = buildController(answerWith(EXCHANGE_INFO), storage);

        expect(reopened.store.read().tags[0]?.pairs).toEqual([BTC]);
    });

    it('opens a tag it has just made, because that is where the next press files', () => {
        const markets = buildController(answerWith(EXCHANGE_INFO));

        markets.addTag('Shitcoins');

        expect(markets.store.read().openTagId).not.toBe(FAVOURITES_ID);
        expect(markets.store.read().tags).toHaveLength(2);
    });

    it('stays where it was when the label was refused', () => {
        const markets = buildController(answerWith(EXCHANGE_INFO));

        markets.addTag('   ');

        expect(markets.store.read().openTagId).toBe(FAVOURITES_ID);
    });

    it('falls back to the first tag when the open one is removed', () => {
        const markets = buildController(answerWith(EXCHANGE_INFO));
        markets.addTag('Shitcoins');
        const made = markets.store.read().openTagId;

        markets.removeTag(made);

        expect(markets.store.read().openTagId).toBe(FAVOURITES_ID);
    });
});

describe('asking a venue what it trades', () => {
    it('says it is reading before it has an answer', async () => {
        const markets = buildController(answerWith(EXCHANGE_INFO));

        const reading = markets.readListing(FIRST_VENUE);

        expect(markets.store.read().listings[FIRST_VENUE]?.kind).toBe('reading');
        await reading;
    });

    it('holds what the venue listed', async () => {
        const markets = buildController(answerWith(EXCHANGE_INFO));

        await markets.readListing(FIRST_VENUE);

        const listing = markets.store.read().listings[FIRST_VENUE];
        expect(listing?.kind === 'read' && listing.instruments[0]?.symbol).toBe('BTCUSDT');
    });

    it('keeps the venue\'s own words when it refuses', async () => {
        const refusing = vi.fn(() => Promise.resolve(new Response('{}', { status: 429 })));
        const markets = buildController(refusing);

        await markets.readListing(FIRST_VENUE);

        const listing = markets.store.read().listings[FIRST_VENUE];
        expect(listing?.kind === 'refused' && listing.said).toContain('429');
    });

    it('leaves the words to the interface when nothing can read the venue', async () => {
        const markets = buildController(answerWith(EXCHANGE_INFO));

        await markets.readListing('never-registered');

        const listing = markets.store.read().listings['never-registered'];
        expect(listing).toEqual({ kind: 'refused', said: null });
    });

    it('lets the second ask win even when the first answers last', async () => {
        // The order that actually happens: a reader presses retry, the stalled
        // first request finally lands, and without the guard it replaces the
        // answer they are looking at with the one they asked to leave.
        const held: ((response: Response) => void)[] = [];
        const stalling = vi.fn(() => new Promise<Response>((settle) => { held.push(settle); }));
        const markets = buildController(stalling);

        const first = markets.readListing(FIRST_VENUE);
        const second = markets.readListing(FIRST_VENUE);
        held[1]!(new Response(JSON.stringify(EXCHANGE_INFO)));
        await second;
        held[0]!(new Response(JSON.stringify({ symbols: [] })));
        await first;

        const listing = markets.store.read().listings[FIRST_VENUE];
        expect(listing?.kind === 'read' && listing.instruments).toHaveLength(1);
    });
});

describe('installing a venue a reader brought', () => {
    beforeEach(() => { vi.spyOn(globalThis, 'fetch'); });

    it('puts it among the venues and starts reading it', async () => {
        const markets = buildController(answerWith({ pairs: [] }));

        const refused = markets.installConnector('kucoin', buildConnector({
            book: null, tape: null, bars: null,
        }), SOURCE);

        expect(refused).toBeNull();
        expect(markets.store.read().venues).toContain('kucoin');
        expect(markets.store.read().browsingVenue).toBe('kucoin');
        await vi.waitFor(() => {
            expect(markets.store.read().listings['kucoin']).toBeDefined();
        });
    });

    it('keeps every file, so a venue written across three is there again next week', () => {
        const storage = buildStorage();
        const markets = buildController(answerWith({}), storage);

        markets.installConnector('kucoin', buildConnector({ book: null, tape: null, bars: null }), SOURCE);

        expect(new PreferencesService({ storage }).read().connectorSources).toEqual([{
            id: 'kucoin', name: 'kucoin', files: SOURCE, installedAtMs: NOW_MS,
        }]);
    });

    it('takes one back off, and forgets it for next week too', () => {
        const storage = buildStorage();
        const markets = buildController(answerWith({}), storage);
        markets.installConnector('kucoin', buildConnector({ book: null, tape: null, bars: null }), SOURCE);

        markets.removeConnector('kucoin');

        expect(markets.store.read().venues).not.toContain('kucoin');
        expect(markets.store.read().installed).toEqual([]);
        expect(new PreferencesService({ storage }).read().connectorSources).toEqual([]);
    });

    it('leaves the pairs a reader kept from a venue they removed', () => {
        // A venue removed by mistake is one press to put back. A tag quietly
        // emptied by that press is not.
        const markets = buildController(answerWith({}));
        markets.installConnector('kucoin', buildConnector({ book: null, tape: null, bars: null }), SOURCE);
        markets.tagPair(FAVOURITES_ID, { venue: 'kucoin', symbol: 'BTC-USDC' });

        markets.removeConnector('kucoin');

        expect(markets.store.read().tags[0]?.pairs).toEqual([{ venue: 'kucoin', symbol: 'BTC-USDC' }]);
    });

    it('will not take away the venue this build ships against', () => {
        const markets = buildController(answerWith({}));

        markets.removeConnector(FIRST_VENUE);

        expect(markets.store.read().venues).toContain(FIRST_VENUE);
    });

    it('says why when the name is one the build already answers to', () => {
        const markets = buildController(answerWith({}));

        const refused = markets.installConnector(
            FIRST_VENUE,
            buildConnector({ book: null, tape: null, bars: null }),
            SOURCE,
        );

        expect(refused).toContain('ships with');
    });
});
