import type { FastifyReply, FastifyRequest } from 'fastify';
import { readReachableUrl, VenueRefusedError } from '../venue-reach.ts';

/** How long a venue is given before the server stops waiting for it. */
const VENUE_TIMEOUT_MS = 15_000;

/** How large a venue's answer may be before it is refused unread. */
const VENUE_BYTE_LIMIT = 8 * 1024 * 1024;

export interface VenueHandlerConfig {
    /** Injected so a test can answer without a network. */
    readonly fetch: typeof globalThis.fetch;
}

/**
 * Builds the handler that fetches what a connector described.
 *
 * The engine's half of the connector contract, performed here rather than in
 * the page: most venues publish no cross-origin header, so a browser cannot
 * read them at all. What the page cannot do, the server can — under one
 * timeout, one size limit, https only, no redirects, and nothing of the
 * server's own network reachable.
 *
 * @param config - How the server reaches the network.
 * @returns A handler answering with whatever the venue said, verbatim.
 */
export function createVenueHandler(config: VenueHandlerConfig) {
    return async function venueHandler(
        request: FastifyRequest<{ Querystring: { url: string } }>,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        let url: string;
        try {
            url = await readReachableUrl(request.query.url);
        } catch (error) {
            if (error instanceof VenueRefusedError) {
                return reply.status(400).send({ message: error.message });
            }
            throw error;
        }

        let answer: Response;
        try {
            answer = await config.fetch(url, {
                signal: AbortSignal.timeout(VENUE_TIMEOUT_MS),
                // Never followed. A redirect is a second URL nothing checked,
                // and answering one is how a public host hands the server a
                // private one.
                redirect: 'manual',
                headers: { accept: 'application/json' },
            });
        } catch {
            return reply.status(502).send({ message: 'The venue could not be reached.' });
        }

        if (answer.status >= 300 && answer.status < 400) {
            return reply.status(502).send({ message: 'The venue redirected, which is not followed.' });
        }

        const declared = Number(answer.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > VENUE_BYTE_LIMIT) {
            return reply.status(502).send({ message: 'The venue answered with more than this will read.' });
        }

        const body = await answer.text();
        if (body.length > VENUE_BYTE_LIMIT) {
            return reply.status(502).send({ message: 'The venue answered with more than this will read.' });
        }

        // Passed through with the venue's own status, so a connector reads the
        // refusal the venue actually gave rather than one invented here. Sent as
        // text with the type set by hand: parsing and re-serialising would turn
        // a body this server does not understand into one it does.
        return reply.status(answer.status).type('application/json').send(body);
    };
}
