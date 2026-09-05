import pMap from 'p-map';
import type { VenueConnector, VenueInstrument, VenueRequest } from '../core/venue-connector.ts';

/** How long the engine waits before deciding a venue is not going to answer. */
const REQUEST_TIMEOUT_MS = 15_000;

/** How large an answer may be before it is refused unread. */
const RESPONSE_BYTE_LIMIT = 8 * 1024 * 1024;

/** Only these may be fetched: a connector must not reach a private network. */
const ALLOWED_PROTOCOL = 'https:';

/**
 * Pages one listing may be asked for before the engine stops asking.
 *
 * A connector that answers every page with another page is one whose listing
 * never returns, and the reader is looking at a spinner either way.
 */

/**
 * Pages in the air at once, where the venue said how many there are.
 *
 * A listing is a reader waiting, so the pages go out together rather than one
 * after another. Bounded because a venue answering forty requests in one breath
 * is a venue that starts refusing them, and a rate limit costs the whole listing
 * rather than the page it landed on.
 *
 * A pool rather than a batch: the next page starts the moment a slot frees,
 * instead of every page waiting on the slowest of the five it was grouped with.
 */

export interface VenueGatewayConfig {
    /** Injected so a test can answer without a network. */
    readonly fetch: typeof globalThis.fetch;
    /**
     * Where the server fetches on a connector's behalf, when there is a server.
     *
     * Most venues publish no cross-origin header, so a page cannot read them at
     * all — a connector for one would be refused by the browser before it ever
     * reached the venue. Absent in a build with no server, where a page can only
     * reach a venue that lets it.
     */
    readonly reachThrough?: string | undefined;
}

/**
 * Everything gathered so far that is still in the venue's own order.
 *
 * Stops at the first page that has not landed: reporting past it would show a
 * later page's pairs above an earlier page's, and then move them once the gap
 * filled — a listing that rearranges itself under the reader's cursor.
 *
 * @param landed - Each page at its own place, with holes for what is in flight.
 * @returns The instruments up to the first hole.
 */
function readUpToGap(
    landed: readonly (readonly VenueInstrument[] | undefined)[],
): readonly VenueInstrument[] {
    const gathered: VenueInstrument[] = [];
    for (const page of landed) {
        if (page === undefined) {
            return gathered;
        }
        gathered.push(...page);
    }
    return gathered;
}

/**
 * Raised when a venue could not be read, with the venue's own words kept.
 */
export class VenueUnreachableError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'VenueUnreachableError';
    }
}

/**
 * Performs what a connector describes.
 *
 * The whole of the engine's half of the contract: the connector says which URL
 * and reads what comes back, and everything that can hang, fail, or take too
 * long happens here — where there is a timeout, a size limit, and one place to
 * look when a venue misbehaves.
 */
export class VenueGateway {
    private readonly config: VenueGatewayConfig;

    constructor(config: VenueGatewayConfig) {
        this.config = config;
    }

    /**
     * Everything a venue lists, as the chart names instruments.
     *
     * Handed over as it arrives rather than only at the end: a venue with four
     * thousand pairs is several requests, and a reader watching an empty card
     * until the last one lands has no way of telling a slow listing from a
     * broken one.
     *
     * @param connector - The connector for that venue.
     * @param onRead - Called with each page gathered so far, and the total the
     *                 venue named if it named one.
     * @param signal - Aborts the fetch when the reader has moved on.
     * @returns Its listing, in the venue's own order.
     * @throws VenueUnreachableError when the venue refuses, stalls, or answers
     *         with something the connector cannot read.
     */
    async fetchInstruments(
        connector: VenueConnector,
        onRead?: (gathered: readonly VenueInstrument[], total: number | null) => void,
        signal?: AbortSignal,
    ): Promise<readonly VenueInstrument[]> {
        const first = await this.perform(connector.planInstruments(0), signal);
        const opening = this.readPage(connector, first);
        const total = this.readTotal(connector, first);
        onRead?.(opening, total);

        // Two shapes of paging, and a venue answers to one of them. Where it
        // says how many it has, every remaining page can be asked for at once;
        // where it only hands out a cursor, they can only be walked.
        const rest = total !== null && opening.length > 0 && total > opening.length
            ? await this.fetchPagesAtOnce(connector, opening, total, onRead, signal)
            : await this.walkPages(connector, first, opening, onRead, signal);

        return [...opening, ...rest];
    }

    /**
     * What a venue matches against a reader's typing, where it offers that.
     *
     * @param connector - The connector for that venue.
     * @param term - What the reader typed.
     * @param signal - Aborts the fetch when the reader types again.
     * @returns What the venue answered, or null where it offers no search.
     * @throws VenueUnreachableError on the same failures as every other request.
     */
    async searchInstruments(
        connector: VenueConnector,
        term: string,
        signal?: AbortSignal,
    ): Promise<readonly VenueInstrument[] | null> {
        const request = connector.planInstrumentSearch(term);
        if (request === null) {
            return null;
        }

        return this.readPage(connector, await this.perform(request, signal));
    }

    /**
     * The pages after the first, read through a pool of that many at a time.
     *
     * Kept in the order the venue serves them rather than in the order they
     * answer: a listing that reshuffles itself between two readings is one a
     * reader cannot learn the shape of, and the venue's own order is usually the
     * one worth keeping.
     */
    private async fetchPagesAtOnce(
        connector: VenueConnector,
        opening: readonly VenueInstrument[],
        total: number,
        onRead: ((gathered: readonly VenueInstrument[], total: number | null) => void) | undefined,
        signal: AbortSignal | undefined,
    ): Promise<readonly VenueInstrument[]> {
        // The page size the venue actually served, rather than one declared
        // somewhere else and then not honoured.
        const perPage = opening.length;
        const wanted: number[] = [];
        const { pagesPerListing, requestsAtOnce } = connector.pacing;
        for (let from = perPage; from < total && wanted.length < pagesPerListing - 1; from += perPage) {
            wanted.push(from);
        }

        // Filled in at each page's own place, so what has landed can be handed
        // over without the pages that landed early jumping the queue.
        const landed: (readonly VenueInstrument[] | undefined)[] = [];
        const pages = await pMap(wanted, async (from, at) => {
            const page = this.readPage(connector, await this.perform(connector.planInstruments(from), signal));
            landed[at] = page;
            onRead?.([...opening, ...readUpToGap(landed)], total);
            return page;
        }, {
            concurrency: requestsAtOnce,
            ...signal === undefined ? {} : { signal },
        });

        return pages.flat();
    }

    /**
     * The pages after the first, for a venue that names each in the one before.
     */
    private async walkPages(
        connector: VenueConnector,
        first: unknown,
        opening: readonly VenueInstrument[],
        onRead: ((gathered: readonly VenueInstrument[], total: number | null) => void) | undefined,
        signal: AbortSignal | undefined,
    ): Promise<readonly VenueInstrument[]> {
        const gathered: VenueInstrument[] = [];
        let payload = first;
        let request = this.readNext(connector, payload, opening.length);

        // Capped, because a connector that always answers with another page is
        // one whose listing never returns.
        for (let page = 1; request !== null && page < connector.pacing.pagesPerListing; page += 1) {
            payload = await this.perform(request, signal);
            gathered.push(...this.readPage(connector, payload));
            request = this.readNext(connector, payload, opening.length + gathered.length);
            onRead?.([...opening, ...gathered], null);
        }

        return gathered;
    }

    /**
     * One page read by the connector, with its own failures named as the venue's.
     */
    private readPage(connector: VenueConnector, payload: unknown): readonly VenueInstrument[] {
        try {
            return connector.readInstruments(payload);
        } catch (error) {
            throw new VenueUnreachableError('The connector could not read the listing.', { cause: error });
        }
    }

    /**
     * How many the venue said it lists, or null where it said nothing readable.
     */
    private readTotal(connector: VenueConnector, payload: unknown): number | null {
        try {
            const total = connector.readInstrumentTotal(payload);
            return total !== null && Number.isFinite(total) && total > 0 ? Math.floor(total) : null;
        } catch (error) {
            throw new VenueUnreachableError('The connector could not read the listing.', { cause: error });
        }
    }

    /**
     * Where the connector says the next page is.
     */
    private readNext(connector: VenueConnector, payload: unknown, read: number): VenueRequest | null {
        try {
            return connector.continueInstruments(payload, read);
        } catch (error) {
            throw new VenueUnreachableError('The connector could not read the listing.', { cause: error });
        }
    }

    /**
     * Fetches one request a connector described, and parses it as JSON.
     *
     * @param request - What the connector asked for.
     * @param signal - The caller's own abort, joined with the deadline.
     * @returns The parsed answer.
     * @throws VenueUnreachableError on a refusal, a stall, an oversized answer,
     *         a scheme other than HTTPS, or an answer that is not JSON.
     */
    async perform(request: VenueRequest, signal?: AbortSignal): Promise<unknown> {
        const url = this.routeTo(this.readUrl(request.url));
        const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const aborts = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);

        const response = await this.send(url, request, aborts);
        if (!response.ok) {
            throw new VenueUnreachableError(`The venue refused with ${String(response.status)}.`);
        }

        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > RESPONSE_BYTE_LIMIT) {
            throw new VenueUnreachableError('The venue answered with more than the engine will read.');
        }

        try {
            return await response.json();
        } catch (error) {
            throw new VenueUnreachableError('The venue answered with something that is not JSON.', { cause: error });
        }
    }

    /**
     * Sends the request, turning every network failure into one kind.
     */
    private async send(
        url: string,
        request: VenueRequest,
        signal: AbortSignal,
    ): Promise<Response> {
        try {
            return await this.config.fetch(url, {
                signal,
                // Never the reader's cookies: a connector names its own URL, and
                // a venue's own session must not ride along to it.
                credentials: 'omit',
                ...request.method === undefined ? {} : { method: request.method },
                ...request.body === undefined ? {} : { body: request.body },
                ...request.headers === undefined ? {} : { headers: request.headers },
            });
        } catch (error) {
            throw new VenueUnreachableError('The venue could not be reached.', { cause: error });
        }
    }

    /**
     * The URL to actually fetch: the venue's, or the server's stand-in for it.
     *
     * The venue's own URL is what is checked and what is passed along, so the
     * connector's plan is the thing being performed either way.
     */
    private routeTo(url: string): string {
        const through = this.config.reachThrough;
        return through === undefined ? url : `${through}?url=${encodeURIComponent(url)}`;
    }

    /**
     * The URL, refused unless it is one the engine is willing to fetch.
     */
    private readUrl(candidate: string): string {
        let parsed: URL;
        try {
            parsed = new URL(candidate);
        } catch {
            throw new VenueUnreachableError(`“${candidate}” is not a URL.`);
        }

        // A connector is code a reader installed. Held to HTTPS so that one
        // cannot quietly name a file, a local service, or the machine's own
        // metadata endpoint and have the engine fetch it on their behalf.
        if (parsed.protocol !== ALLOWED_PROTOCOL) {
            throw new VenueUnreachableError(`A connector may only reach https, not ${parsed.protocol}`);
        }
        return parsed.toString();
    }
}
