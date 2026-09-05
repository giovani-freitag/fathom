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
const PAGES_PER_LISTING = 20;

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
     * @param connector - The connector for that venue.
     * @param signal - Aborts the fetch when the reader has moved on.
     * @returns Its listing, in the order the venue gave it.
     * @throws VenueUnreachableError when the venue refuses, stalls, or answers
     *         with something the connector cannot read.
     */
    async fetchInstruments(
        connector: VenueConnector,
        signal?: AbortSignal,
    ): Promise<readonly VenueInstrument[]> {
        const gathered: VenueInstrument[] = [];
        let request: VenueRequest | null = connector.planInstruments();

        // A venue that serves its listing in pages is asked for the next one
        // until it says there is none. Capped, because a connector that always
        // answers with another page is one that never returns.
        for (let page = 0; request !== null && page < PAGES_PER_LISTING; page += 1) {
            const payload = await this.perform(request, signal);
            try {
                gathered.push(...connector.readInstruments(payload));
                request = connector.continueInstruments(payload, gathered.length);
            } catch (error) {
                throw new VenueUnreachableError('The connector could not read the listing.', { cause: error });
            }
        }

        return gathered;
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
