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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * OKX's spot market: a past and a tape, and no book.
 *
 * The book is the interesting absence. This venue publishes one of the best
 * there is — every update names the sequence before it — but it publishes the
 * opening ladder over the same socket, as the first message of the
 * subscription. A connector describes a request and reads an answer, so it has
 * nowhere to say "the snapshot arrives on the stream", and the ladder endpoint
 * this venue does serve is stamped with a clock rather than with a sequence the
 * updates could be joined to.
 *
 * Declared `null` rather than half-implemented, which is the whole point of the
 * declaration: no heatmap here, and the reason is a sentence rather than a gap.
 */
class Okx extends Connector {
    private static readonly REST = 'https://www.okx.com';

    private static readonly SOCKET = 'wss://ws.okx.com:8443';

    /** What the venue calls each width it serves candles at. */
    private static readonly WIDTH_NAMES = new Map<number, string>([
        [MINUTE_MS, '1m'],
        [3 * MINUTE_MS, '3m'],
        [5 * MINUTE_MS, '5m'],
        [15 * MINUTE_MS, '15m'],
        [30 * MINUTE_MS, '30m'],
        [HOUR_MS, '1H'],
        [2 * HOUR_MS, '2H'],
        [4 * HOUR_MS, '4H'],
        [6 * HOUR_MS, '6H'],
        [12 * HOUR_MS, '12H'],
        [DAY_MS, '1D'],
        [7 * DAY_MS, '1W'],
    ]);

    /** A candle as the wire sends it, in the usual order for once. */
    private static readonly OPENED_AT = 0;
    private static readonly OPEN_PRICE = 1;
    private static readonly HIGH_PRICE = 2;
    private static readonly LOW_PRICE = 3;
    private static readonly CLOSE_PRICE = 4;
    private static readonly VOLUME = 5;

    /** How many fields a candle must have before it is worth reading. */
    private static readonly CANDLE_FIELDS = 6;

    /** Four days past the epoch, which is where a week that opens on Monday starts. */
    private static readonly MONDAY_MS = 4 * DAY_MS;

    readonly declaration: VenueDeclaration = {
        book: null,
        tape: {
            siding: 'sided',
            clock: 'venue',
            hasStableIds: true,
        },
        bars: {
            rungs: [...Okx.WIDTH_NAMES.keys()].map((widthMs) => ({
                widthMs,
                anchorMs: widthMs === 7 * DAY_MS ? Okx.MONDAY_MS : 0,
            })),
            // A hundred, which is what the endpoint that reaches back serves.
            barsPerRequest: 100,
            hasVolume: true,
            hasBuyVolume: false,
            hasTradeCount: false,
        },
    };

    override planInstruments(from: number): VenueRequest {
        void from;
        return { url: this.address(Okx.REST, '/api/v5/public/instruments', { instType: 'SPOT' }) };
    }

    override readInstruments(payload: unknown): readonly VenueInstrument[] {
        return this.requireList(payload, 'data')
            .map((listed) => this.readInstrument(listed))
            .filter((instrument) => instrument !== null);
    }

    override planStream(symbol: string): VenueStreamPlan {
        return {
            url: `${Okx.SOCKET}/ws/v5/public`,
            greetings: [JSON.stringify({
                op: 'subscribe',
                args: [{ channel: 'trades', instId: symbol }],
            })],
            // The venue closes a socket that has said nothing for thirty
            // seconds, and it wants the word rather than a frame.
            heartbeat: { everyMs: 20_000, send: 'ping' },
        };
    }

    override readTrades(payload: unknown): readonly ExecutedTrade[] {
        const message = payload as { arg?: { channel?: unknown }; data?: unknown };
        if (message.arg?.channel !== 'trades') {
            return [];
        }

        return (Array.isArray(message.data) ? message.data : [])
            .map((print) => this.readTrade(print))
            .filter((trade) => trade !== null);
    }

    override planBars(request: BarPageRequest): VenueRequest {
        const bar = Okx.WIDTH_NAMES.get(request.widthMs);
        if (bar === undefined) {
            throw new Error(`No venue candle of width ${String(request.widthMs)}ms`);
        }

        return {
            // The endpoint that reaches back rather than the one that serves the
            // last day: a connector holds no clock, so it cannot tell which of
            // the two a window belongs to, and only this one answers for both.
            url: this.address(Okx.REST, '/api/v5/market/history-candles', {
                instId: request.symbol,
                bar,
                // `before` is the older edge and `after` the newer one, which is
                // the opposite of how they read.
                before: Math.floor(request.fromMs),
                after: Math.floor(request.toMs),
                limit: Math.min(request.limit, 100),
            }),
        };
    }

    override readBars(payload: unknown, request: BarPageRequest): readonly VenueBar[] {
        return this.requireList(payload, 'data')
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
        const symbol = entry['instId'];
        const base = entry['baseCcy'];
        const quote = entry['quoteCcy'];
        if (typeof symbol !== 'string' || typeof base !== 'string' || typeof quote !== 'string') {
            return null;
        }

        return {
            symbol,
            base,
            quote,
            priceStep: this.readNumber(entry['tickSz']) ?? 0,
            isTrading: entry['state'] === 'live',
        };
    }

    /**
     * One print off the stream, or null where a field is unreadable.
     */
    private readTrade(print: unknown): ExecutedTrade | null {
        const entry = print as Record<string, unknown>;
        const executedAtMs = this.readNumber(entry['ts']);
        const price = this.readNumber(entry['px']);
        const quantity = this.readNumber(entry['sz']);
        if (executedAtMs === null || price === null || quantity === null) {
            return null;
        }

        return {
            executedAtMs,
            price,
            quantity,
            // The side named is the side that crossed the spread.
            isAggressorSelling: entry['side'] === 'sell',
        };
    }

    /**
     * One candle out of the tuple, or null where a field is unreadable.
     */
    private readCandle(row: unknown, widthMs: number): VenueBar | null {
        if (!Array.isArray(row) || row.length < Okx.CANDLE_FIELDS) {
            return null;
        }

        const openedAtMs = this.readNumber(row[Okx.OPENED_AT]);
        const closePrice = this.readNumber(row[Okx.CLOSE_PRICE]);
        if (openedAtMs === null || closePrice === null) {
            return null;
        }

        return {
            openedAtMs,
            closedAtMs: openedAtMs + widthMs,
            openPrice: this.readNumber(row[Okx.OPEN_PRICE]) ?? closePrice,
            highPrice: this.readNumber(row[Okx.HIGH_PRICE]) ?? closePrice,
            lowPrice: this.readNumber(row[Okx.LOW_PRICE]) ?? closePrice,
            closePrice,
            volume: this.readNumber(row[Okx.VOLUME]),
            buyVolume: null,
            tradeCount: null,
        };
    }
}

/** The one instance of it, as the engine holds it. */
export const OKX_CONNECTOR: VenueConnector = new Okx();

/** What this venue is registered under. */
export const OKX_ID = 'okx';
