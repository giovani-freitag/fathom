import { Connector } from '../core/venue-connector.ts';
import type { ExecutedTrade } from '../core/depth-types.ts';
import type {
    BarPageRequest,
    VenueBar,
    VenueConnector,
    VenueInstrument,
    VenueRequest,
    VenueStreamPlan,
} from '../core/venue-connector.ts';
import type { VenueDeclaration } from '../core/venue-plan.ts';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Coinbase's exchange: a past and a tape, and no book.
 *
 * The absence here is the other kind. This venue publishes a full order book
 * over its socket, but only to a connection that has signed in — and there is
 * nowhere in Fathom to keep a key, by design. What is left is public: what it
 * lists, what it traded, and the candles it has kept.
 */
class Coinbase extends Connector {
    private static readonly REST = 'https://api.exchange.coinbase.com';

    private static readonly SOCKET = 'wss://ws-feed.exchange.coinbase.com';

    /**
     * What the venue calls each width it serves candles at, in seconds.
     *
     * Six of them and no more: this is the one shipped venue with no four-hour
     * candle at all, which is a rung the chart simply does not offer here.
     */
    private static readonly WIDTHS = new Map<number, number>([
        [MINUTE_MS, 60],
        [5 * MINUTE_MS, 300],
        [15 * MINUTE_MS, 900],
        [HOUR_MS, 3_600],
        [6 * HOUR_MS, 21_600],
        [DAY_MS, 86_400],
    ]);

    /**
     * A candle as the wire sends it, in the venue's own order.
     *
     * `low` and `high` before `open` and `close`, which is a third ordering
     * again — and the reason a connector reads positions by name.
     */
    private static readonly OPENED_AT = 0;
    private static readonly LOW_PRICE = 1;
    private static readonly HIGH_PRICE = 2;
    private static readonly OPEN_PRICE = 3;
    private static readonly CLOSE_PRICE = 4;
    private static readonly VOLUME = 5;

    /** How many fields a candle must have before it is worth reading. */
    private static readonly CANDLE_FIELDS = 6;

    readonly declaration: VenueDeclaration = {
        book: null,
        tape: {
            siding: 'sided',
            clock: 'venue',
            hasStableIds: true,
        },
        bars: {
            rungs: [...Coinbase.WIDTHS.keys()].map((widthMs) => ({ widthMs, anchorMs: 0 })),
            barsPerRequest: 300,
            hasVolume: true,
            hasBuyVolume: false,
            hasTradeCount: false,
        },
    };

    override planInstruments(from: number): VenueRequest {
        void from;
        return { url: this.address(Coinbase.REST, '/products') };
    }

    override readInstruments(payload: unknown): readonly VenueInstrument[] {
        // The whole answer, with no envelope around it — which `requireList`
        // reads by being given no field to look under.
        return this.requireList(payload)
            .map((listed) => this.readInstrument(listed))
            .filter((instrument) => instrument !== null);
    }

    override planStream(symbol: string): VenueStreamPlan {
        return {
            url: Coinbase.SOCKET,
            greetings: [JSON.stringify({
                type: 'subscribe',
                product_ids: [symbol],
                channels: ['matches'],
            })],
            heartbeat: { everyMs: 20_000, send: JSON.stringify({ type: 'heartbeat', on: true }) },
        };
    }

    override readTrades(payload: unknown): readonly ExecutedTrade[] {
        const message = payload as Record<string, unknown>;
        // `last_match` is the one print that was already done when the socket
        // opened, replayed for context. Both are prints; both are read.
        if (message['type'] !== 'match' && message['type'] !== 'last_match') {
            return [];
        }

        const executedAtMs = this.readInstant(message['time']);
        const price = this.readNumber(message['price']);
        const quantity = this.readNumber(message['size']);
        if (executedAtMs === null || price === null || quantity === null) {
            return [];
        }

        return [{
            executedAtMs,
            price,
            quantity,
            // The side named is the *maker's*, which is the side that was
            // resting. Read as the aggressor's it reverses every print on the
            // venue, and a tape that is exactly wrong still looks like a tape.
            isAggressorSelling: message['side'] === 'buy',
        }];
    }

    override planBars(request: BarPageRequest): VenueRequest {
        const granularity = Coinbase.WIDTHS.get(request.widthMs);
        if (granularity === undefined) {
            throw new Error(`No venue candle of width ${String(request.widthMs)}ms`);
        }

        return {
            url: this.address(Coinbase.REST, `/products/${encodeURIComponent(request.symbol)}/candles`, {
                granularity,
                // Seconds, and named as the edges of the window rather than as
                // a count from one of them.
                start: Math.floor(request.fromMs / SECOND_MS),
                end: Math.floor(request.toMs / SECOND_MS),
            }),
        };
    }

    override readBars(payload: unknown, request: BarPageRequest): readonly VenueBar[] {
        return this.requireList(payload)
            .map((row) => this.readCandle(row, request.widthMs))
            .filter((bar) => bar !== null)
            // Newest first on the wire, and every reading downstream walks bars
            // forwards.
            .reverse();
    }

    /**
     * One listing, or null where the venue named something the chart cannot draw.
     */
    private readInstrument(listed: unknown): VenueInstrument | null {
        const entry = listed as Record<string, unknown>;
        const symbol = entry['id'];
        const base = entry['base_currency'];
        const quote = entry['quote_currency'];
        if (typeof symbol !== 'string' || typeof base !== 'string' || typeof quote !== 'string') {
            return null;
        }

        return {
            symbol,
            base,
            quote,
            priceStep: this.readNumber(entry['quote_increment']) ?? 0,
            // Two ways of being closed, and a pair that is either is one no
            // order reaches.
            isTrading: entry['status'] === 'online' && entry['trading_disabled'] !== true,
        };
    }

    /**
     * An instant out of the venue's own stamp, which is a sentence of text.
     */
    private readInstant(stamp: unknown): number | null {
        if (typeof stamp !== 'string') {
            return null;
        }

        const at = Date.parse(stamp);
        return Number.isFinite(at) ? at : null;
    }

    /**
     * One candle out of the tuple, or null where a field is unreadable.
     */
    private readCandle(row: unknown, widthMs: number): VenueBar | null {
        if (!Array.isArray(row) || row.length < Coinbase.CANDLE_FIELDS) {
            return null;
        }

        const openedAtSeconds = this.readNumber(row[Coinbase.OPENED_AT]);
        const closePrice = this.readNumber(row[Coinbase.CLOSE_PRICE]);
        if (openedAtSeconds === null || closePrice === null) {
            return null;
        }

        const openedAtMs = openedAtSeconds * SECOND_MS;
        return {
            openedAtMs,
            closedAtMs: openedAtMs + widthMs,
            openPrice: this.readNumber(row[Coinbase.OPEN_PRICE]) ?? closePrice,
            highPrice: this.readNumber(row[Coinbase.HIGH_PRICE]) ?? closePrice,
            lowPrice: this.readNumber(row[Coinbase.LOW_PRICE]) ?? closePrice,
            closePrice,
            volume: this.readNumber(row[Coinbase.VOLUME]),
            buyVolume: null,
            tradeCount: null,
        };
    }
}

/** The one instance of it, as the engine holds it. */
export const COINBASE_CONNECTOR: VenueConnector = new Coinbase();

/** What this venue is registered under. */
export const COINBASE_ID = 'coinbase';
