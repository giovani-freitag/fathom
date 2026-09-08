import type { DepthDiff, DepthSnapshot, ExecutedTrade } from './depth-types.ts';
import type { VenueDeclaration } from './venue-plan.ts';

/**
 * A connector: what a venue can do, and how to read what it says.
 *
 * Every method here is pure and synchronous, and every argument and return is
 * plain data. A connector holds no socket, no promise and no timer; it describes
 * a request and reads an answer, and the engine does the rest.
 *
 * That is not a matter of taste. The supervisor awaits each recording it tears
 * down, so a connector owning its own socket would own a close that can hang —
 * and one that never settles wedges the reconcile pass for every contract on the
 * machine, one bad connector stopping four good recordings.
 */

/** How a request is made, for the few venues that will not answer a plain read. */
export type RequestMethod = 'GET' | 'POST';

/**
 * A request for the engine to perform.
 *
 * A description rather than a fetch: the connector never reaches the network
 * itself, so it cannot hang, cannot retry behind the engine's back, and cannot
 * send anything the engine did not see first.
 */
export interface VenueRequest {
    readonly url: string;
    /** Omitted for the ordinary read, which is every listing and every candle. */
    readonly method?: RequestMethod;
    /** Sent as it stands, for a venue that asks to be posted to. */
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
}

/**
 * How fast the engine may ask this venue for things.
 *
 * The one thing about a venue that only its own connector can know. A rate
 * limit is published per exchange, in that exchange's units, so a figure picked
 * in the engine is a guess that is wrong for everybody: too high and the venue
 * refuses the whole listing rather than the page it landed on, too low and a
 * reader waits through round trips the venue would have answered together.
 *
 * Inherited from the base class, so a connector writes this only where its
 * venue differs from the shipped ones.
 */
export interface VenuePacing {
    /**
     * Most pages the engine asks a listing for before it stops asking.
     *
     * A ceiling rather than a race: a venue that always answers with another
     * page is one whose listing never returns.
     */
    readonly pagesPerListing: number;
    /** How many requests may be in the air at this venue at once. */
    readonly requestsAtOnce: number;
}

/**
 * What the shipped venues tolerate, and what a connector gets for saying nothing.
 */
export const DEFAULT_PACING: VenuePacing = { pagesPerListing: 20, requestsAtOnce: 5 };

/**
 * The widest pacing the engine will perform, whatever a connector asks for.
 *
 * Not a second opinion on the venue's rate limit, which the connector knows
 * better: a guard against the typo that would have a reader's own address
 * refused by the venue before they could read the error.
 */
const PACING_CEILING: VenuePacing = { pagesPerListing: 500, requestsAtOnce: 20 };

/** A socket to open, and what to say once it is open. */
export interface VenueStreamPlan {
    readonly url: string;
    /**
     * What to send on connecting, where the venue needs to be asked.
     *
     * Empty for a venue that takes its subscription in the URL.
     */
    readonly greetings?: readonly string[];
    /**
     * What to send periodically to be left connected.
     *
     * Null where the venue's own pings are enough. The engine owns the timer.
     */
    readonly heartbeat?: { readonly everyMs: number; readonly send: string } | null;
}

/** One instrument, as a venue lists it. */
export interface VenueInstrument {
    /** What the venue calls it, which is what every later request repeats back. */
    readonly symbol: string;
    readonly base: string;
    readonly quote: string;
    /**
     * The smallest price move the venue quotes.
     *
     * Carried because the chart buckets prices, and a bucket finer than the tick
     * draws a ladder of stripes with nothing between them.
     */
    readonly priceStep: number;
    /** False for a listing that exists but is halted, delisted, or not yet open. */
    readonly isTrading: boolean;
}

/**
 * One candle, with the venue's own opt-outs in it.
 *
 * Null rather than zero wherever the venue publishes nothing: zero is a real
 * answer here — a bucket nobody traded in is a quiet bucket — so a venue that
 * counts no prints has to be distinguishable from one whose bar was quiet, or
 * the difference is written flat across its whole history.
 *
 * Whether the bar has closed is deliberately absent: that is a comparison
 * against now, and a connector holds no clock.
 */
export interface VenueBar {
    readonly openedAtMs: number;
    readonly closedAtMs: number;
    readonly openPrice: number;
    readonly highPrice: number;
    readonly lowPrice: number;
    readonly closePrice: number;
    readonly volume: number | null;
    /** What crossed the spread upward, where the venue splits its volume. */
    readonly buyVolume: number | null;
    readonly tradeCount: number | null;
}

/** One page of candles asked for. */
export interface BarPageRequest {
    readonly symbol: string;
    readonly widthMs: number;
    readonly fromMs: number;
    readonly toMs: number;
    readonly limit: number;
}

/**
 * Everything the engine needs to read one venue.
 *
 * Flat, and every method on the connector itself. The methods a venue does not
 * have are the ones its declaration says `null` for, and the base class answers
 * those by refusing — so there is one place a capability is claimed, and
 * registration checks the methods against it.
 */
export interface VenueConnector {
    readonly declaration: VenueDeclaration;

    /** How fast this venue may be asked; the base class answers for most. */
    readonly pacing: VenuePacing;

    /**
     * Where the venue's own mark can be fetched, for the lists it appears in.
     *
     * Named outright or not at all. It was once guessed at `/favicon.ico` on
     * the host the API answers from, which is a host that serves no mark for
     * most venues: the guess failed for five of the six shipped, and failed
     * silently, so nobody looked for the address that would have worked.
     *
     * Null draws the letter the venue starts with, which is not a stopgap but
     * the other half of the design — a venue a reader brought themselves may
     * have no mark to name.
     */
    readonly markUrl: string | null;

    /**
     * Every venue lists what it trades; there is nothing to chart otherwise.
     *
     * @param from - How many instruments come before the page being asked for,
     *               nought for the first. Ignored by a venue that serves its
     *               listing whole, which is most of them.
     */
    planInstruments: (from: number) => VenueRequest;
    /**
     * @param payload - Whatever the venue answered, already parsed from JSON.
     * @returns Every instrument this page listed.
     * @throws Error when the answer is not the shape the connector expects.
     */
    readInstruments: (payload: unknown) => readonly VenueInstrument[];
    /**
     * How many instruments the venue says it lists in all.
     *
     * The difference between a listing read one page at a time and one read at
     * once: knowing the total, the engine asks for every remaining page
     * together rather than waiting for each to name the next.
     *
     * @param payload - The first page, as it arrived.
     * @returns The count, or null where the venue does not publish one.
     */
    readInstrumentTotal: (payload: unknown) => number | null;
    /**
     * The next page, for a venue whose pages can only be reached in order.
     *
     * The other shape of paging: a cursor the venue hands out with each page,
     * which cannot be guessed and so cannot be asked for in parallel.
     *
     * @param payload - The page just read.
     * @param read - How many instruments have been gathered so far.
     * @returns What to fetch next, or null once the listing is whole.
     */
    continueInstruments: (payload: unknown, read: number) => VenueRequest | null;
    /**
     * What the venue itself matches against a reader's typing.
     *
     * Where a venue offers this, a reader searching a listing that is still
     * arriving gets the venue's own answer instead of a search across the part
     * that happens to have loaded.
     *
     * @param term - What the reader typed, trimmed and not empty.
     * @returns The request, read by `readInstruments`, or null where the venue
     *          offers no such endpoint — which is most of them.
     */
    planInstrumentSearch: (term: string) => VenueRequest | null;

    /**
     * One socket carrying everything the venue streams.
     *
     * One rather than one per capability, because that is how venues sell it:
     * a book and a tape on separate sockets is two connections against a limit
     * that is usually counted per address, and two independent reconnects whose
     * gaps do not line up in the ledger.
     *
     * @param symbol - The instrument being recorded.
     * @param ticket - What `readStreamTicket` returned, or empty where the venue
     *                 needs none.
     */
    planStream: (symbol: string, ticket: string) => VenueStreamPlan;
    /**
     * The request that buys a socket, for a venue handing them out per session.
     *
     * @returns The request, or null for a venue whose socket URL is fixed.
     */
    planStreamTicket: () => VenueRequest | null;
    /**
     * @param payload - What that request answered.
     * @returns Whatever `planStream` needs to build its URL — usually a token.
     */
    readStreamTicket: (payload: unknown) => string;

    planSnapshot: (symbol: string) => VenueRequest;
    readSnapshot: (payload: unknown) => DepthSnapshot;
    /**
     * @param payload - One message off the socket, already parsed.
     * @returns The change it carried, or null for anything else on the stream.
     */
    readUpdate: (payload: unknown) => DepthDiff | null;
    /**
     * @param payload - One message off the socket, already parsed.
     * @returns Every print it carried, empty for anything else on the stream.
     */
    readTrades: (payload: unknown) => readonly ExecutedTrade[];

    planBars: (request: BarPageRequest) => VenueRequest;
    /**
     * @param payload - The venue's answer, already parsed from JSON.
     * @param request - What was asked for, handed back because most venues name
     *                  only where a candle opens, and the width is what turns
     *                  that into the first instant it does not hold.
     * @returns The candles it carried, oldest first.
     */
    readBars: (payload: unknown, request: BarPageRequest) => readonly VenueBar[];
}

/** The methods each capability needs, for registration to check them against it. */
const NEEDED = {
    book: ['planStream', 'planSnapshot', 'readSnapshot', 'readUpdate'],
    tape: ['planStream', 'readTrades'],
    bars: ['planBars', 'readBars'],
} as const satisfies Record<keyof VenueDeclaration, readonly (keyof VenueConnector)[]>;

/**
 * Where a connector contradicts itself.
 *
 * Checked when it is registered rather than when a recording starts, because the
 * second is hours later, on a machine nobody is watching, and the contradiction
 * was already in the file.
 *
 * The declaration is what claims; the methods are what can answer. A venue that
 * declares a book and never wrote the methods behind one is a chart waiting for
 * a message that never comes, and a venue with the methods and no declaration is
 * one quietly doing more than the chart was told to expect.
 *
 * @param connector - The connector being registered.
 * @returns One sentence per contradiction, empty where there are none.
 */
export function findContradictions(connector: VenueConnector): readonly string[] {
    const found: string[] = [];

    for (const [capability, methods] of Object.entries(NEEDED)) {
        const isDeclared = connector.declaration[capability as keyof VenueDeclaration] !== null;
        const missing = methods.filter((name) => !isWritten(connector, name));

        if (isDeclared && missing.length > 0) {
            found.push(`It declares ${capability} but never wrote ${missing.join(', ')}.`);
        }
        // `planStream` belongs to two capabilities, so writing it alone claims
        // neither; only a reader that belongs to one does.
        const claimed = methods.filter((name) => name !== 'planStream' && isWritten(connector, name));
        if (!isDeclared && claimed.length > 0) {
            found.push(`It reads ${capability} but declares it has none.`);
        }
    }

    return found;
}

/**
 * Where a connector asks to be paced in a way the engine will not perform.
 *
 * Read at registration beside the contradictions, and for the same reason: a
 * listing capped at nought pages fetches nothing, and the reader finds out when
 * the chart stays empty rather than when the file was written.
 *
 * @param connector - The connector being registered.
 * @returns One sentence per fault, empty where there are none.
 */
export function findPacingFaults(connector: VenueConnector): readonly string[] {
    const found: string[] = [];
    const { pacing } = connector;

    for (const field of ['pagesPerListing', 'requestsAtOnce'] as const) {
        const asked = pacing[field];
        if (!Number.isInteger(asked) || asked < 1) {
            found.push(`Its ${field} is ${String(asked)}, which is not a count of anything.`);
            continue;
        }
        if (asked > PACING_CEILING[field]) {
            found.push(`Its ${field} is ${asked}, past the ${PACING_CEILING[field]} this engine performs.`);
        }
    }

    return found;
}

/**
 * Whether a connector wrote a method rather than inheriting the refusal.
 */
function isWritten(connector: VenueConnector, name: keyof VenueConnector): boolean {
    return connector[name] !== Connector.prototype[name];
}

/**
 * What a connector is written as.
 *
 * Methods on the class, not objects of functions hung off it. Every one a venue
 * does not have is inherited from here and refuses, so a connector is only as
 * long as what its venue can actually answer — and the declaration stays the one
 * place a capability is claimed.
 *
 * It also carries the two readings every connector repeats: a figure a venue
 * sent as text, and a list that has to be somewhere in the answer.
 */
export abstract class Connector implements VenueConnector {
    abstract readonly declaration: VenueDeclaration;

    /** What the shipped venues tolerate, until a connector says otherwise. */
    readonly pacing: VenuePacing = DEFAULT_PACING;

    /** The letter the venue starts with, unless a connector names an address. */
    readonly markUrl: string | null = null;

    abstract planInstruments(from: number): VenueRequest;

    abstract readInstruments(payload: unknown): readonly VenueInstrument[];

    /**
     * How many the venue says it lists. None said, unless a connector says so.
     *
     * @returns Null, which is a listing whose length is only known by reading it.
     */
    readInstrumentTotal(payload: unknown): number | null {
        void payload;
        return null;
    }

    /**
     * The next page of the listing. One page, unless a connector says otherwise.
     *
     * @returns Null, which is a listing served whole.
     */
    continueInstruments(payload: unknown, read: number): VenueRequest | null {
        void payload;
        void read;
        return null;
    }

    /**
     * What the venue matches against typing. Nothing, unless it offers it.
     *
     * @returns Null, which is a venue whose listing is searched where it lands.
     */
    planInstrumentSearch(term: string): VenueRequest | null {
        void term;
        return null;
    }

    /**
     * The socket to open.
     *
     * @returns Never; a venue declaring no book and no tape streams nothing.
     * @throws Error, because nothing should have asked.
     */
    planStream(symbol: string, ticket: string): VenueStreamPlan {
        void symbol;
        void ticket;
        throw new Error('This venue streams nothing.');
    }

    /**
     * The request that buys a socket. None, unless a connector says otherwise.
     *
     * @returns Null, which is a socket whose URL is fixed.
     */
    planStreamTicket(): VenueRequest | null {
        return null;
    }

    /**
     * What a ticket request answered. Nothing, for a venue that needs none.
     *
     * @returns The empty string.
     */
    readStreamTicket(payload: unknown): string {
        void payload;
        return '';
    }

    /**
     * Where the resting ladder is fetched from.
     *
     * @returns Never; a venue declaring no book has none to fetch.
     * @throws Error, because nothing should have asked.
     */
    planSnapshot(symbol: string): VenueRequest {
        void symbol;
        throw new Error('This venue publishes no book.');
    }

    /**
     * The ladder out of that answer.
     *
     * @returns Never, for the same reason.
     * @throws Error, because nothing should have asked.
     */
    readSnapshot(payload: unknown): DepthSnapshot {
        void payload;
        throw new Error('This venue publishes no book.');
    }

    /**
     * One book update off the socket.
     *
     * @returns Null, which is how every message that is not one is answered.
     */
    readUpdate(payload: unknown): DepthDiff | null {
        void payload;
        return null;
    }

    /**
     * The prints one message carried.
     *
     * @returns None, which is how every message carrying none is answered.
     */
    readTrades(payload: unknown): readonly ExecutedTrade[] {
        void payload;
        return [];
    }

    /**
     * Where one page of candles is fetched from.
     *
     * @returns Never; a venue declaring no bars serves none.
     * @throws Error, because nothing should have asked.
     */
    planBars(request: BarPageRequest): VenueRequest {
        void request;
        throw new Error('This venue serves no candles.');
    }

    /**
     * The candles out of that answer.
     *
     * @returns Never, for the same reason.
     * @throws Error, because nothing should have asked.
     */
    readBars(payload: unknown, request: BarPageRequest): readonly VenueBar[] {
        void payload;
        void request;
        throw new Error('This venue serves no candles.');
    }

    /**
     * An address, built rather than spelled out.
     *
     * Through `URL` and its own query, because a URL joined by hand is a URL
     * with a reader's symbol pasted into it unescaped — and because the pieces
     * are easier to read down a list than inside one long sum of strings.
     *
     * @param base - The venue's origin, as its own constant.
     * @param path - The endpoint, from the root.
     * @param query - What to ask for, in the order given. An entry left
     *                undefined is left out, so an optional parameter needs no
     *                branch around it.
     * @returns The whole address.
     */
    protected address(
        base: string,
        path: string,
        query: Readonly<Record<string, string | number | undefined>> = {},
    ): string {
        const built = new URL(path, base);
        for (const [name, value] of Object.entries(query)) {
            if (value !== undefined) {
                built.searchParams.set(name, String(value));
            }
        }
        return built.href;
    }

    /**
     * A figure as a number, or null where it does not read as one.
     *
     * Null rather than NaN or zero: a price that reads as NaN is written as a
     * real print and no later read can tell it from one, and zero is a real
     * answer everywhere a venue publishes figures.
     *
     * @param field - Whatever arrived in that position.
     * @returns The number, or null.
     */
    protected readNumber(field: unknown): number | null {
        const value = Number(field);
        return typeof field !== 'boolean' && field !== null && field !== ''
            && Number.isFinite(value) ? value : null;
    }

    /**
     * A list out of a venue's answer, or a refusal saying it sent none.
     *
     * @param payload - What the venue answered, already parsed from JSON.
     * @param at - The field the list is under, or absent where it is the answer.
     * @returns The entries, unread.
     * @throws Error when there is no list where the connector said there is one.
     */
    protected requireList(payload: unknown, at?: string): readonly unknown[] {
        const held = at === undefined ? payload : (payload as Record<string, unknown> | null)?.[at];
        if (!Array.isArray(held)) {
            throw new Error(`The venue answered with no list${at === undefined ? '' : ` under “${at}”`}.`);
        }
        return held;
    }
}
