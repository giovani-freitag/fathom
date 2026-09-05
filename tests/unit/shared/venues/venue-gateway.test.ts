import { describe, expect, it, vi } from 'vitest';
import { VenueGateway, VenueUnreachableError } from '../../../../src/shared/venues/venue-gateway.ts';
import { buildConnector } from '../../../mocks/venue-connectors.ts';

const NOTHING: Parameters<typeof buildConnector>[0] = { book: null, tape: null, bars: null };

function answerWith(body: unknown, init: ResponseInit = {}): typeof globalThis.fetch {
    return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), init)));
}

/** How many a venue serving its listing in pages hands over at a time. */
const PER_PAGE = 500;

function instrument(symbol: string) {
    return { symbol, base: symbol.slice(0, 3), quote: 'USDT', priceStep: 0.1, isTrading: true };
}

/** Every symbol a listing of that many holds, in the venue's own order. */
function everySymbol(total: number): string[] {
    return Array.from({ length: Math.min(total, 20 * PER_PAGE) }, (_, at) => `P${String(at)}`);
}

/**
 * A connector for a venue that pages, and says how many it has.
 */
function pagedConnector() {
    return Object.assign(buildConnector(NOTHING), {
        planInstruments: (from: number) => ({ url: `https://venue.test/pairs?from=${String(from)}` }),
        readInstruments: (payload: unknown) => (payload as { pairs: [] }).pairs,
        readInstrumentTotal: (payload: unknown) => (payload as { total: number }).total,
    });
}

/**
 * A venue serving a listing of that size, five hundred at a time.
 *
 * @param total - How many it says it lists.
 * @param asked - Filled in with every URL it was asked for.
 * @param order - `slowest: 'first'` answers the earliest page last, which is
 *                what a network does to requests sent together.
 */
function pagesOf(
    total: number,
    asked: string[],
    order: { slowest?: 'first' } = {},
): typeof globalThis.fetch {
    return vi.fn(async (url: string) => {
        asked.push(url);
        const from = Number(new URL(url).searchParams.get('from'));
        if (order.slowest === 'first') {
            await new Promise((wake) => { setTimeout(wake, from === 0 ? 0 : 20 - (from / PER_PAGE)); });
        }

        const pairs = Array.from(
            { length: Math.max(0, Math.min(PER_PAGE, total - from)) },
            (_, at) => instrument(`P${String(from + at)}`),
        );
        return new Response(JSON.stringify({ pairs, total }));
    }) as unknown as typeof globalThis.fetch;
}

describe('what the engine does with a plan', () => {
    it('fetches the URL the connector named and hands back what it answered', async () => {
        const fetch = answerWith({ ok: true });
        const gateway = new VenueGateway({ fetch });

        const answer = await gateway.perform({ url: 'https://venue.test/list' });

        expect(answer).toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledWith('https://venue.test/list', expect.objectContaining({
            credentials: 'omit',
        }));
    });

    it('never sends the reader\'s cookies with it', async () => {
        // A connector names its own URL. A venue's own session riding along to
        // whatever that URL turns out to be is the whole of the risk.
        const fetch = answerWith({});
        await new VenueGateway({ fetch }).perform({ url: 'https://venue.test/list' });

        expect(vi.mocked(fetch).mock.calls[0]?.[1]?.credentials).toBe('omit');
    });

    it('refuses a URL that is not https', async () => {
        // Held to https so a connector cannot name a file, a service on the
        // machine, or its metadata endpoint and have the engine fetch it.
        const gateway = new VenueGateway({ fetch: answerWith({}) });

        await expect(gateway.perform({ url: 'http://169.254.169.254/latest/meta-data/' }))
            .rejects.toThrow(VenueUnreachableError);
    });

    it('refuses something that is not a URL at all', async () => {
        const gateway = new VenueGateway({ fetch: answerWith({}) });

        await expect(gateway.perform({ url: 'wherever' })).rejects.toThrow(/is not a URL/);
    });

    it('says which status the venue refused with', async () => {
        const gateway = new VenueGateway({ fetch: answerWith({}, { status: 418 }) });

        await expect(gateway.perform({ url: 'https://venue.test/list' })).rejects.toThrow(/418/);
    });

    it('refuses an answer larger than it is willing to read', async () => {
        const oversized = vi.fn(() => Promise.resolve(new Response('{}', {
            headers: { 'content-length': String(64 * 1024 * 1024) },
        }))) as unknown as typeof globalThis.fetch;
        const gateway = new VenueGateway({ fetch: oversized });

        await expect(gateway.perform({ url: 'https://venue.test/list' }))
            .rejects.toThrow(/more than the engine will read/);
    });

    it('turns a network failure into one kind, keeping what it was', async () => {
        const refused = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof globalThis.fetch;
        const gateway = new VenueGateway({ fetch: refused });

        await expect(gateway.perform({ url: 'https://venue.test/list' }))
            .rejects.toThrow(VenueUnreachableError);
    });

    it('says so when the venue answers with something that is not JSON', async () => {
        const html = vi.fn(() => Promise.resolve(new Response('<html>rate limited</html>'))) as unknown as typeof globalThis.fetch;
        const gateway = new VenueGateway({ fetch: html });

        await expect(gateway.perform({ url: 'https://venue.test/list' })).rejects.toThrow(/not JSON/);
    });
});

describe('reading a listing through a connector', () => {
    it('hands the venue\'s answer to the connector that asked for it', async () => {
        const connector = Object.assign(buildConnector(NOTHING), {
            planInstruments: () => ({ url: 'https://venue.test/pairs' }),
            readInstruments: (payload: unknown) => (payload as { pairs: [] }).pairs,
        });
        const gateway = new VenueGateway({
            fetch: answerWith({ pairs: [{ symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', priceStep: 0.1, isTrading: true }] }),
        });

        const listed = await gateway.fetchInstruments(connector);

        expect(listed).toHaveLength(1);
    });

    it('asks for every remaining page at once, where the venue said how many', async () => {
        // The difference between a listing and a wait: four thousand pairs at
        // five hundred a page is eight requests, and asking for each only after
        // the one before it has answered is eight round trips a reader watches.
        const asked: string[] = [];
        const gateway = new VenueGateway({ fetch: pagesOf(1_250, asked) });

        const listed = await gateway.fetchInstruments(pagedConnector());

        expect(listed.map((one) => one.symbol)).toEqual(everySymbol(1_250));
        expect(asked).toHaveLength(3);
    });

    it('starts the next page the moment a slot frees, rather than in batches', async () => {
        // A batch of five waits for the slowest of the five before the sixth
        // request is even sent. On a venue with one slow page that is the whole
        // listing held up by it, over and over.
        let inFlight = 0;
        let mostAtOnce = 0;
        let started = 0;
        let startedWhenSlowLanded = 0;
        const fetch = vi.fn(async (url: string) => {
            const from = Number(new URL(url).searchParams.get('from'));
            started += 1;
            inFlight += 1;
            mostAtOnce = Math.max(mostAtOnce, inFlight);
            // The first page of the pool answers last, which is what holds a
            // batch up and what a pool reads straight past.
            await new Promise((wake) => { setTimeout(wake, from === 500 ? 40 : 0); });
            inFlight -= 1;
            if (from === 500) {
                startedWhenSlowLanded = started;
            }
            return new Response(JSON.stringify({
                pairs: Array.from({ length: 500 }, (_, at) => instrument(`P${String(from + at)}`)),
                total: 4_000,
            }));
        }) as unknown as typeof globalThis.fetch;

        await new VenueGateway({ fetch }).fetchInstruments(pagedConnector());

        // Eight pages in all: the first, then seven through the pool.
        expect(startedWhenSlowLanded).toBe(8);
        expect(mostAtOnce).toBeLessThanOrEqual(5);
    });

    it('keeps the venue\'s own order, whichever page answers first', async () => {
        // The pages go out together and come back in whatever order the network
        // hands them over. A listing that reshuffles itself between two readings
        // is one a reader cannot learn the shape of.
        const gateway = new VenueGateway({ fetch: pagesOf(1_250, [], { slowest: 'first' }) });

        const listed = await gateway.fetchInstruments(pagedConnector());

        expect(listed.map((one) => one.symbol)).toEqual(everySymbol(1_250));
    });

    it('hands over each page as it lands, so the picker can show it', async () => {
        const seen: number[] = [];
        const gateway = new VenueGateway({ fetch: pagesOf(1_250, []) });

        await gateway.fetchInstruments(pagedConnector(), (gathered, total) => {
            seen.push(gathered.length);
            expect(total).toBe(1_250);
        });

        expect(seen[0]).toBe(500);
        expect(seen.at(-1)).toBe(1_250);
    });

    it('stops at the page the engine will not read past', async () => {
        // A venue claiming a million pairs is a venue the engine reads twenty
        // pages of, rather than one it reads until the reader gives up.
        const asked: string[] = [];
        const gateway = new VenueGateway({ fetch: pagesOf(1_000_000, asked) });

        await gateway.fetchInstruments(pagedConnector());

        expect(asked).toHaveLength(20);
    });

    it('stops where the connector says its listing stops, not where the engine used to', async () => {
        // The venue publishes the limit, in its own units, and the connector is
        // the only thing in the build that has read it.
        const asked: string[] = [];
        const connector = Object.assign(pagedConnector(), {
            pacing: { pagesPerListing: 4, requestsAtOnce: 2 },
        });
        const gateway = new VenueGateway({ fetch: pagesOf(1_000_000, asked) });

        await gateway.fetchInstruments(connector);

        expect(asked).toHaveLength(4);
    });

    it('keeps to the number of requests the connector says the venue tolerates', async () => {
        // Above that a venue starts refusing, and a refusal costs the whole
        // listing rather than the page it landed on.
        let inFlight = 0;
        let atMost = 0;
        const connector = Object.assign(pagedConnector(), {
            pacing: { pagesPerListing: 20, requestsAtOnce: 2 },
        });
        const gateway = new VenueGateway({
            fetch: vi.fn(async (url: string) => {
                inFlight += 1;
                atMost = Math.max(atMost, inFlight);
                // Held open across a turn of the event loop, so the pool fills
                // to its limit before anything leaves it. A microtask is not
                // long enough: each request would finish before the next began,
                // and the count would read one however wide the pool was.
                await new Promise((resolve) => { setTimeout(resolve, 5); });
                const from = Number(new URL(url).searchParams.get('from'));
                inFlight -= 1;
                return new Response(JSON.stringify({
                    total: 5_000,
                    pairs: everySymbol(5_000).slice(from, from + PER_PAGE).map(instrument),
                }));
            }) as unknown as typeof globalThis.fetch,
        });

        await gateway.fetchInstruments(connector);

        expect(atMost).toBeLessThanOrEqual(2);
    });

    it('walks page by page where the venue only hands out a cursor', async () => {
        // The other shape: a token that cannot be guessed, so the pages can
        // only be asked for in order.
        const connector = Object.assign(buildConnector(NOTHING), {
            planInstruments: () => ({ url: 'https://venue.test/pairs' }),
            readInstruments: (payload: unknown) => (payload as { pairs: [] }).pairs,
            continueInstruments: (payload: unknown) => {
                const next = (payload as { next?: string }).next;
                return next === undefined ? null : { url: next };
            },
        });
        const fetch = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(
            url.includes('after=1')
                ? { pairs: [instrument('B')] }
                : { pairs: [instrument('A')], next: 'https://venue.test/pairs?after=1' },
        )))) as unknown as typeof globalThis.fetch;

        const listed = await new VenueGateway({ fetch }).fetchInstruments(connector);

        expect(listed.map((one) => one.symbol)).toEqual(['A', 'B']);
    });

    it('asks the venue what a reader typed, where the venue answers that', async () => {
        const connector = Object.assign(buildConnector(NOTHING), {
            planInstruments: () => ({ url: 'https://venue.test/pairs' }),
            readInstruments: (payload: unknown) => (payload as { pairs: [] }).pairs,
            planInstrumentSearch: (term: string) => ({ url: `https://venue.test/find?q=${term}` }),
        });
        const fetch = answerWith({ pairs: [instrument('NANOUSDT')] });

        const found = await new VenueGateway({ fetch }).searchInstruments(connector, 'nano');

        expect(found?.map((one) => one.symbol)).toEqual(['NANOUSDT']);
        expect(fetch).toHaveBeenCalledWith('https://venue.test/find?q=nano', expect.anything());
    });

    it('says nothing rather than nothing found, where the venue offers no search', async () => {
        // The two are opposite answers: one means the pair is not listed, the
        // other means the question has to be asked of what was already read.
        const fetch = answerWith({});
        const connector = Object.assign(buildConnector(NOTHING), {
            planInstruments: () => ({ url: 'https://venue.test/pairs' }),
            readInstruments: () => [],
        });

        expect(await new VenueGateway({ fetch }).searchInstruments(connector, 'nano')).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('blames the connector when it cannot read what the venue sent', async () => {
        const connector = Object.assign(buildConnector(NOTHING), {
            planInstruments: () => ({ url: 'https://venue.test/pairs' }),
            readInstruments: (): never => { throw new Error('no symbols'); },
        });
        const gateway = new VenueGateway({ fetch: answerWith({}) });

        await expect(gateway.fetchInstruments(connector)).rejects.toThrow(/could not read the listing/);
    });
});

describe('reaching a venue a browser cannot read', () => {
    it('asks the server to fetch it, naming the venue\'s own URL', async () => {
        // KuCoin, and most venues, publish no cross-origin header. A connector
        // for one is refused by the browser before it reaches the venue.
        const fetch = answerWith({});
        const gateway = new VenueGateway({ fetch, reachThrough: 'http://localhost:8080/api/venue' });

        await gateway.perform({ url: 'https://api.kucoin.com/api/v2/symbols' });

        expect(fetch).toHaveBeenCalledWith(
            'http://localhost:8080/api/venue?url=https%3A%2F%2Fapi.kucoin.com%2Fapi%2Fv2%2Fsymbols',
            expect.anything(),
        );
    });

    it('still refuses a URL it would not fetch itself', async () => {
        // Checked before it is handed on, so the server is never asked to reach
        // something the page would not have.
        const fetch = answerWith({});
        const gateway = new VenueGateway({ fetch, reachThrough: 'http://localhost:8080/api/venue' });

        await expect(gateway.perform({ url: 'file:///etc/passwd' })).rejects.toThrow(VenueUnreachableError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('goes straight to the venue where there is no server to ask', async () => {
        const fetch = answerWith({});
        const gateway = new VenueGateway({ fetch });

        await gateway.perform({ url: 'https://fapi.binance.com/fapi/v1/exchangeInfo' });

        expect(fetch).toHaveBeenCalledWith('https://fapi.binance.com/fapi/v1/exchangeInfo', expect.anything());
    });
});
