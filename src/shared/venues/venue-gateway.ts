import type { VenueConnector, VenueInstrument, VenueRequest } from '../core/venue-connector.ts';

/** How long the engine waits before deciding a venue is not going to answer. */
const REQUEST_TIMEOUT_MS = 15_000;

/** How large an answer may be before it is refused unread. */
const RESPONSE_BYTE_LIMIT = 8 * 1024 * 1024;

/** Only these may be fetched: a connector must not reach a private network. */
const ALLOWED_PROTOCOL = 'https:';

export interface VenueGatewayConfig {
    /** Injected so a test can answer without a network. */
    readonly fetch: typeof globalThis.fetch;
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
        const payload = await this.perform(connector.instruments.planInstruments(), signal);
        try {
            return connector.instruments.readInstruments(payload);
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
        const url = this.readUrl(request.url);
        const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const aborts = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);

        const response = await this.send(url, request.headers, aborts);
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
        headers: Readonly<Record<string, string>> | undefined,
        signal: AbortSignal,
    ): Promise<Response> {
        try {
            return await this.config.fetch(url, {
                signal,
                // Never the reader's cookies: a connector names its own URL, and
                // a venue's own session must not ride along to it.
                credentials: 'omit',
                ...headers === undefined ? {} : { headers },
            });
        } catch (error) {
            throw new VenueUnreachableError('The venue could not be reached.', { cause: error });
        }
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
