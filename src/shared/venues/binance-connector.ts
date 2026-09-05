import { BINANCE_FUTURES } from './binance-futures.ts';
import type { DepthDiff, DepthSnapshot, ExecutedTrade, SerializedPriceLevel } from '../core/depth-types.ts';
import type {
    BarPageRequest,
    VenueBar,
    VenueConnector,
    VenueInstrument,
    VenueRequest,
} from '../core/venue-connector.ts';
import { nameVenueInterval } from '../core/venue-bar-interval.ts';

/** Where the venue serves its past and its ladders from. */
const REST_BASE_URL = 'https://fapi.binance.com';

/** Where it publishes what is happening now. */
const SOCKET_BASE_URL = 'wss://fstream.binance.com';

/** The deepest ladder the snapshot endpoint serves in one call. */
const SNAPSHOT_LEVELS = 1_000;

/**
 * A candle as the wire sends it: a tuple, not an object.
 *
 * Indices rather than names because that is what arrives. Only these seven are
 * read; the rest is the venue's own bookkeeping.
 */
const OPENED_AT = 0;
const OPEN_PRICE = 1;
const HIGH_PRICE = 2;
const LOW_PRICE = 3;
const CLOSE_PRICE = 4;
const VOLUME = 5;
const CLOSED_AT = 6;
const TRADE_COUNT = 8;
const TAKER_BUY_VOLUME = 9;

/**
 * The venue every recording so far came from.
 *
 * Written against the same endpoints the collector has been reading for months,
 * so that the contract is proved by the one venue whose behaviour is known
 * rather than by a second one written to fit it.
 */
export const BINANCE_CONNECTOR: VenueConnector = {
    declaration: BINANCE_FUTURES,

    instruments: {
        planInstruments: (): VenueRequest => ({ url: `${REST_BASE_URL}/fapi/v1/exchangeInfo` }),
        readInstruments: (payload: unknown): readonly VenueInstrument[] => {
            const listed = (payload as { symbols?: unknown }).symbols;
            if (!Array.isArray(listed)) {
                throw new Error('The venue listed no symbols.');
            }
            return listed.map(readInstrument).filter((instrument) => instrument !== null);
        },
    },

    // One socket carrying both, which is what the venue sells and what the
    // collector has been opening all along.
    planStream: (symbol: string) => ({
        url: `${SOCKET_BASE_URL}/stream?streams=${symbol.toLowerCase()}@depth@100ms/${symbol.toLowerCase()}@trade`,
    }),

    book: {
        planSnapshot: (symbol: string): VenueRequest => ({
            url: `${REST_BASE_URL}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${String(SNAPSHOT_LEVELS)}`,
        }),
        readSnapshot: (payload: unknown): DepthSnapshot => {
            const answer = payload as { lastUpdateId?: unknown; bids?: unknown; asks?: unknown };
            if (typeof answer.lastUpdateId !== 'number' || !Array.isArray(answer.bids) || !Array.isArray(answer.asks)) {
                throw new Error('The venue answered with an unreadable ladder.');
            }
            return {
                lastUpdateId: answer.lastUpdateId,
                bidLevels: answer.bids as readonly SerializedPriceLevel[],
                askLevels: answer.asks as readonly SerializedPriceLevel[],
            };
        },
        readUpdate: (payload: unknown): DepthDiff | null => {
            const update = readEnvelope(payload, 'depthUpdate');
            if (update === null) {
                return null;
            }
            const candidate = update as Record<string, unknown>;
            // An absent side reaches the mirror as something to iterate over and
            // throws inside the socket's own message handler.
            if (typeof candidate['U'] !== 'number' || typeof candidate['u'] !== 'number'
                || typeof candidate['pu'] !== 'number'
                || !Array.isArray(candidate['b']) || !Array.isArray(candidate['a'])) {
                return null;
            }
            return {
                firstUpdateId: candidate['U'],
                finalUpdateId: candidate['u'],
                previousFinalUpdateId: candidate['pu'],
                bidLevels: candidate['b'] as readonly SerializedPriceLevel[],
                askLevels: candidate['a'] as readonly SerializedPriceLevel[],
            };
        },
    },

    tape: {
        readTrades: (payload: unknown): readonly ExecutedTrade[] => {
            const print = readEnvelope(payload, 'trade');
            if (print === null) {
                return [];
            }
            const candidate = print as Record<string, unknown>;
            // A price that reads as NaN is written as a real print, and no later
            // read can tell it from one.
            if (typeof candidate['T'] !== 'number' || typeof candidate['m'] !== 'boolean'
                || !isNumericText(candidate['p']) || !isNumericText(candidate['q'])) {
                return [];
            }
            return [{
                executedAtMs: candidate['T'],
                price: Number(candidate['p']),
                quantity: Number(candidate['q']),
                isAggressorSelling: candidate['m'],
            }];
        },
    },

    bars: {
        planPage: (request: BarPageRequest): VenueRequest => {
            const interval = nameVenueInterval(request.widthMs);
            if (interval === null) {
                throw new Error(`No venue candle of width ${String(request.widthMs)}ms`);
            }
            const url = new URL('/fapi/v1/klines', REST_BASE_URL);
            url.searchParams.set('symbol', request.symbol);
            url.searchParams.set('interval', interval);
            url.searchParams.set('startTime', String(Math.floor(request.fromMs)));
            url.searchParams.set('endTime', String(Math.floor(request.toMs)));
            url.searchParams.set('limit', String(request.limit));
            return { url: url.toString() };
        },
        readPage: (payload: unknown): readonly VenueBar[] => {
            if (!Array.isArray(payload)) {
                throw new Error('The venue answered candles with something that is not a list.');
            }
            return payload.map(readCandle).filter((bar) => bar !== null);
        },
    },
};

/**
 * One listing, or null where the venue named something the chart cannot draw.
 */
function readInstrument(listed: unknown): VenueInstrument | null {
    const entry = listed as Record<string, unknown>;
    const symbol = entry['symbol'];
    const base = entry['baseAsset'];
    const quote = entry['quoteAsset'];
    if (typeof symbol !== 'string' || typeof base !== 'string' || typeof quote !== 'string') {
        return null;
    }

    return {
        symbol,
        base,
        quote,
        priceStep: readPriceStep(entry['filters']),
        isTrading: entry['status'] === 'TRADING',
    };
}

/**
 * The smallest price move, out of the venue's list of filters.
 *
 * Zero where the venue named none, which the caller reads as "unknown" rather
 * than as a tick of nothing.
 */
function readPriceStep(filters: unknown): number {
    if (!Array.isArray(filters)) {
        return 0;
    }
    for (const filter of filters as readonly Record<string, unknown>[]) {
        if (filter['filterType'] === 'PRICE_FILTER' && isNumericText(filter['tickSize'])) {
            return Number(filter['tickSize']);
        }
    }
    return 0;
}

/**
 * One candle out of the tuple, or null where a field is unreadable.
 */
function readCandle(entry: unknown): VenueBar | null {
    if (!Array.isArray(entry) || entry.length <= TAKER_BUY_VOLUME) {
        return null;
    }

    const openedAtMs = Number(entry[OPENED_AT]);
    const closedAtMs = Number(entry[CLOSED_AT]);
    const prices = [OPEN_PRICE, HIGH_PRICE, LOW_PRICE, CLOSE_PRICE].map((at) => Number(entry[at]));
    if (!Number.isFinite(openedAtMs) || !Number.isFinite(closedAtMs) || prices.some((price) => !Number.isFinite(price))) {
        return null;
    }

    const [openPrice, highPrice, lowPrice, closePrice] = prices as [number, number, number, number];
    return {
        openedAtMs,
        // The venue closes a candle on the last millisecond it holds; the chart
        // treats the edge as the first it does not.
        closedAtMs: closedAtMs + 1,
        openPrice,
        highPrice,
        lowPrice,
        closePrice,
        volume: readNumber(entry[VOLUME]),
        buyVolume: readNumber(entry[TAKER_BUY_VOLUME]),
        tradeCount: readNumber(entry[TRADE_COUNT]),
    };
}

/**
 * A field as a number, or null where it does not read as one.
 */
function readNumber(field: unknown): number | null {
    const value = Number(field);
    return Number.isFinite(value) ? value : null;
}

/**
 * The payload inside a stream envelope, where it is the event asked for.
 */
function readEnvelope(payload: unknown, eventType: string): unknown {
    const inner = (payload as { data?: unknown } | null)?.data;
    if (typeof inner !== 'object' || inner === null) {
        return null;
    }
    return (inner as { e?: unknown }).e === eventType ? inner : null;
}

/**
 * Whether a field carries a number the venue wrote as text.
 */
function isNumericText(field: unknown): boolean {
    return typeof field === 'string' && field.length > 0 && Number.isFinite(Number(field));
}
