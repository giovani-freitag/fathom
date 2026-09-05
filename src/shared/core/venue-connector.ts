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

/**
 * A request for the engine to perform.
 *
 * A URL and headers rather than a fetch: the connector never reaches the network
 * itself, so it cannot hang, cannot retry behind the engine's back, and cannot
 * send anything the engine did not see first.
 */
export interface VenueRequest {
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
}

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

/** How a venue's instrument listing is asked for and read. */
export interface InstrumentReader {
    planInstruments: () => VenueRequest;
    /**
     * @param payload - Whatever the venue answered, already parsed from JSON.
     * @returns Every instrument it listed.
     * @throws Error when the answer is not the shape the connector expects.
     */
    readInstruments: (payload: unknown) => readonly VenueInstrument[];
}

/** How a venue's resting book is asked for and read. */
export interface BookReader {
    planSnapshot: (symbol: string) => VenueRequest;
    readSnapshot: (payload: unknown) => DepthSnapshot;
    /**
     * @param payload - One message off the socket, already parsed.
     * @returns The change it carried, or null for anything else on the stream.
     */
    readUpdate: (payload: unknown) => DepthDiff | null;
}

/** How a venue's executions are read. */
export interface TapeReader {
    /**
     * @param payload - One message off the socket, already parsed.
     * @returns Every print it carried, empty for anything else on the stream.
     */
    readTrades: (payload: unknown) => readonly ExecutedTrade[];
}

/** How a venue's candles are asked for and read. */
export interface BarReader {
    planPage: (request: BarPageRequest) => VenueRequest;
    /**
     * @param payload - The venue's answer, already parsed from JSON.
     * @param request - What was asked for, handed back because most venues name
     *                  only where a candle opens, and the width is what turns
     *                  that into the first instant it does not hold.
     * @returns The candles it carried, oldest first.
     */
    readPage: (payload: unknown, request: BarPageRequest) => readonly VenueBar[];
}

/**
 * Everything the engine needs to read one venue.
 *
 * The three optional readers stand exactly where the declaration's three
 * capabilities do, and registration refuses a connector where they disagree:
 * a declared book with nothing that reads one is a chart waiting for a message
 * that never comes, and a reader for a capability that was declared absent is a
 * venue quietly doing more than the chart was told to expect.
 */
export interface VenueConnector {
    readonly declaration: VenueDeclaration;
    /** Every venue lists what it trades; there is nothing to chart otherwise. */
    readonly instruments: InstrumentReader;
    /**
     * One socket carrying everything the venue streams.
     *
     * One rather than one per capability, because that is how venues sell it:
     * a book and a tape on separate sockets is two connections against a limit
     * that is usually counted per address, and two independent reconnects whose
     * gaps do not line up in the ledger.
     *
     * Null exactly where the venue streams nothing.
     */
    readonly planStream: ((symbol: string) => VenueStreamPlan) | null;
    readonly book: BookReader | null;
    readonly tape: TapeReader | null;
    readonly bars: BarReader | null;
}

/**
 * Where a connector contradicts itself.
 *
 * Checked when it is registered rather than when a recording starts, because the
 * second is hours later, on a machine nobody is watching, and the contradiction
 * was already in the file.
 *
 * @param connector - The connector being registered.
 * @returns One sentence per contradiction, empty where there are none.
 */
export function findContradictions(connector: VenueConnector): readonly string[] {
    const found: string[] = [];
    const pairs = [
        ['book', connector.declaration.book, connector.book],
        ['tape', connector.declaration.tape, connector.tape],
        ['bars', connector.declaration.bars, connector.bars],
    ] as const;

    for (const [name, declared, reader] of pairs) {
        if (declared !== null && reader === null) {
            found.push(`It declares ${name} but has nothing that reads one.`);
        }
        if (declared === null && reader !== null) {
            found.push(`It reads ${name} but declares it has none.`);
        }
    }

    const streams = connector.book !== null || connector.tape !== null;
    if (streams && connector.planStream === null) {
        found.push('It reads a stream but names no socket to open.');
    }
    if (!streams && connector.planStream !== null) {
        found.push('It names a socket but reads nothing off one.');
    }
    return found;
}

/**
 * What a connector is written as.
 *
 * Every member is abstract, including the four that may be `null`. A base class
 * that defaulted them would undo the one rule the declaration is built on: an
 * author has to type `null` to say no, and typing it is the moment they read
 * what the engine does instead. Here the compiler is what asks.
 *
 * What it does carry is the two readings every connector repeats — a figure a
 * venue sent as text, and a list that has to be somewhere in the answer.
 */
export abstract class Connector implements VenueConnector {
    abstract readonly declaration: VenueDeclaration;
    abstract readonly instruments: InstrumentReader;
    abstract readonly planStream: ((symbol: string) => VenueStreamPlan) | null;
    abstract readonly book: BookReader | null;
    abstract readonly tape: TapeReader | null;
    abstract readonly bars: BarReader | null;

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
