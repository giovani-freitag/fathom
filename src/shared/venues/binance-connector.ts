import { BINANCE_FUTURES } from './binance-futures.ts';
import { Connector } from '../core/venue-connector.ts';
import type { DepthDiff, DepthSnapshot, ExecutedTrade, SerializedPriceLevel } from '../core/depth-types.ts';
import type {
    BarPageRequest,
    VenueBar,
    VenueConnector,
    VenueInstrument,
    VenueRequest,
    VenueStreamPlan,
} from '../core/venue-connector.ts';
import { nameVenueInterval } from '../core/venue-bar-interval.ts';
import type { VenueDeclaration } from '../core/venue-plan.ts';

/**
 * The venue every recording so far came from.
 *
 * Written against the same endpoints the collector has been reading for months,
 * so that the contract is proved by the one venue whose behaviour is known
 * rather than by a second one written to fit it — and written the way a reader
 * writes one, so that what ships and what they write are the same shape.
 */
class BinanceFutures extends Connector {
    /**
     * The mark, taken from the static host rather than the storefront.
     *
     * `www` answers a bot wall here — 202 and a page of HTML where an icon
     * was asked for — so the address that actually serves the picture is
     * the one the storefront itself loads it from.
     */
    override readonly markUrl = 'https://bin.bnbstatic.com/static/images/common/favicon.ico';

    /** Where the venue serves its past and its ladders from. */
    private static readonly REST = 'https://fapi.binance.com';

    /** Where it publishes what is happening now. */
    private static readonly SOCKET = 'wss://fstream.binance.com';

    /** The deepest ladder the snapshot endpoint serves in one call. */
    private static readonly SNAPSHOT_LEVELS = 1_000;

    /**
     * A candle as the wire sends it: a tuple, not an object.
     *
     * Indices rather than names because that is what arrives. Only these are
     * read; the rest is the venue's own bookkeeping.
     */
    private static readonly OPENED_AT = 0;
    private static readonly OPEN_PRICE = 1;
    private static readonly HIGH_PRICE = 2;
    private static readonly LOW_PRICE = 3;
    private static readonly CLOSE_PRICE = 4;
    private static readonly VOLUME = 5;
    private static readonly CLOSED_AT = 6;
    private static readonly TRADE_COUNT = 8;
    private static readonly TAKER_BUY_VOLUME = 9;

    readonly declaration: VenueDeclaration = BINANCE_FUTURES;

    planInstruments(): VenueRequest {
        return { url: this.address(BinanceFutures.REST, '/fapi/v1/exchangeInfo') };
    }

    readInstruments(payload: unknown): readonly VenueInstrument[] {
        return this.requireList(payload, 'symbols')
            .map((listed) => this.readInstrument(listed))
            .filter((instrument) => instrument !== null);
    }

    /**
     * One socket carrying both, which is what the venue sells and what the
     * collector has been opening all along.
     */
    override planStream(symbol: string): VenueStreamPlan {
        const named = symbol.toLowerCase();
        const url = new URL('/stream', BinanceFutures.SOCKET);
        // Written into the query as it stands rather than through
        // `searchParams`: the venue names its streams with `@` and separates
        // them with `/`, and a percent-encoded name subscribes to nothing.
        url.search = `streams=${named}@depth@100ms/${named}@trade`;
        return { url: url.href };
    }

    override planSnapshot(symbol: string): VenueRequest {
        return {
            url: this.address(BinanceFutures.REST, '/fapi/v1/depth', {
                symbol,
                limit: BinanceFutures.SNAPSHOT_LEVELS,
            }),
        };
    }

    override readSnapshot(payload: unknown): DepthSnapshot {
        const answer = payload as { lastUpdateId?: unknown };
        if (typeof answer.lastUpdateId !== 'number') {
            throw new Error('The venue answered with an unreadable ladder.');
        }
        return {
            lastUpdateId: answer.lastUpdateId,
            bidLevels: this.requireList(payload, 'bids') as readonly SerializedPriceLevel[],
            askLevels: this.requireList(payload, 'asks') as readonly SerializedPriceLevel[],
        };
    }

    override readBars(payload: unknown): readonly VenueBar[] {
        return this.requireList(payload)
            .map((entry) => this.readCandle(entry))
            .filter((bar) => bar !== null);
    }

    override planBars(request: BarPageRequest): VenueRequest {
        const interval = nameVenueInterval(request.widthMs);
        if (interval === null) {
            throw new Error(`No venue candle of width ${String(request.widthMs)}ms`);
        }

        return {
            url: this.address(BinanceFutures.REST, '/fapi/v1/klines', {
                symbol: request.symbol,
                interval,
                startTime: Math.floor(request.fromMs),
                endTime: Math.floor(request.toMs),
                limit: request.limit,
            }),
        };
    }

    /**
     * One listing, or null where the venue named something the chart cannot draw.
     */
    private readInstrument(listed: unknown): VenueInstrument | null {
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
            priceStep: this.readPriceStep(entry['filters']),
            isTrading: entry['status'] === 'TRADING',
        };
    }

    /**
     * The smallest price move, out of the venue's list of filters.
     *
     * Zero where the venue named none, which the caller reads as "unknown"
     * rather than as a tick of nothing.
     */
    private readPriceStep(filters: unknown): number {
        if (!Array.isArray(filters)) {
            return 0;
        }
        for (const filter of filters as readonly Record<string, unknown>[]) {
            if (filter['filterType'] === 'PRICE_FILTER') {
                return this.readNumber(filter['tickSize']) ?? 0;
            }
        }
        return 0;
    }

    /**
     * One book update off the stream, or null for anything else on it.
     */
    override readUpdate(payload: unknown): DepthDiff | null {
        const update = this.readEnvelope(payload, 'depthUpdate');
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
    }

    /**
     * One print off the stream, or none for anything else on it.
     */
    override readTrades(payload: unknown): readonly ExecutedTrade[] {
        const print = this.readEnvelope(payload, 'trade');
        if (print === null) {
            return [];
        }

        const candidate = print as Record<string, unknown>;
        const price = this.readNumber(candidate['p']);
        const quantity = this.readNumber(candidate['q']);
        // A price that reads as NaN is written as a real print, and no later
        // read can tell it from one.
        if (typeof candidate['T'] !== 'number' || typeof candidate['m'] !== 'boolean'
            || price === null || quantity === null) {
            return [];
        }
        return [{
            executedAtMs: candidate['T'],
            price,
            quantity,
            isAggressorSelling: candidate['m'],
        }];
    }

    /**
     * One candle out of the tuple, or null where a field is unreadable.
     */
    private readCandle(entry: unknown): VenueBar | null {
        if (!Array.isArray(entry) || entry.length <= BinanceFutures.TAKER_BUY_VOLUME) {
            return null;
        }

        const openedAtMs = this.readNumber(entry[BinanceFutures.OPENED_AT]);
        const closedAtMs = this.readNumber(entry[BinanceFutures.CLOSED_AT]);
        const prices = [
            BinanceFutures.OPEN_PRICE,
            BinanceFutures.HIGH_PRICE,
            BinanceFutures.LOW_PRICE,
            BinanceFutures.CLOSE_PRICE,
        ].map((at) => this.readNumber(entry[at]));
        if (openedAtMs === null || closedAtMs === null || prices.some((price) => price === null)) {
            return null;
        }

        const [openPrice, highPrice, lowPrice, closePrice] = prices as [number, number, number, number];
        return {
            openedAtMs,
            // The venue closes a candle on the last millisecond it holds; the
            // chart treats the edge as the first it does not.
            closedAtMs: closedAtMs + 1,
            openPrice,
            highPrice,
            lowPrice,
            closePrice,
            volume: this.readNumber(entry[BinanceFutures.VOLUME]),
            buyVolume: this.readNumber(entry[BinanceFutures.TAKER_BUY_VOLUME]),
            tradeCount: this.readNumber(entry[BinanceFutures.TRADE_COUNT]),
        };
    }

    /**
     * The payload inside a stream envelope, where it is the event asked for.
     */
    private readEnvelope(payload: unknown, eventType: string): unknown {
        const inner = (payload as { data?: unknown } | null)?.data;
        if (typeof inner !== 'object' || inner === null) {
            return null;
        }
        return (inner as { e?: unknown }).e === eventType ? inner : null;
    }
}

/**
 * The one instance of it, as the engine holds it.
 *
 * Typed as the contract rather than as the class: every caller reaches it
 * through the registry, and a `bars` the class happens to fill in is still a
 * `bars` the engine has to check before it uses.
 */
export const BINANCE_CONNECTOR: VenueConnector = new BinanceFutures();
