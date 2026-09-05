import { describe, expect, it, vi } from 'vitest';
import { VenueGateway, VenueUnreachableError } from '../../../../src/shared/venues/venue-gateway.ts';
import { buildConnector } from '../../../mocks/venue-connectors.ts';

const NOTHING: Parameters<typeof buildConnector>[0] = { book: null, tape: null, bars: null };

function answerWith(body: unknown, init: ResponseInit = {}): typeof globalThis.fetch {
    return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), init)));
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
