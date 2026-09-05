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
import type { VenueDeclaration } from '../core/venue-plan.ts';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Gate's spot market.
 *
 * The venue that proves the field-order trap is real: its candles are sent
 * `close, high, low, open`, with the quote volume before any of them.
 */
class Gate extends Connector {
    private static readonly REST = 'https://api.gateio.ws';

    private static readonly SOCKET = 'wss://api.gateio.ws/ws/v4/';

    /** The deepest ladder its snapshot serves. */
    private static readonly BOOK_LEVELS = 100;

    /** What the venue calls each width it serves candles at. */
    private static readonly WIDTH_NAMES = new Map<number, string>([
        [10 * SECOND_MS, '10s'],
        [MINUTE_MS, '1m'],
        [5 * MINUTE_MS, '5m'],
        [15 * MINUTE_MS, '15m'],
        [30 * MINUTE_MS, '30m'],
        [HOUR_MS, '1h'],
        [4 * HOUR_MS, '4h'],
        [8 * HOUR_MS, '8h'],
        [DAY_MS, '1d'],
        [7 * DAY_MS, '7d'],
    ]);

    /**
     * A candle as the wire sends it, in the venue's own order.
     *
     * Not the usual one, and not even the usual unusual one: the volume in the
     * quote currency comes second, and the four prices run close, high, low,
     * open. Read as `open, high, low, close` every candle is nonsense that
     * still draws.
     */
    private static readonly OPENED_AT = 0;
    private static readonly QUOTE_VOLUME = 1;
    private static readonly CLOSE_PRICE = 2;
    private static readonly HIGH_PRICE = 3;
    private static readonly LOW_PRICE = 4;
    private static readonly OPEN_PRICE = 5;
    private static readonly BASE_VOLUME = 6;

    /** How many fields a candle must have before it is worth reading. */
    private static readonly CANDLE_FIELDS = 7;

    /** Four days past the epoch, which is where a week that opens on Monday starts. */
    private static readonly MONDAY_MS = 4 * DAY_MS;

    readonly declaration: VenueDeclaration = {
        book: {
            // Every update names the range it covers, and the ranges have to
            // meet — the first id of one is the last of the one before, plus one.
            grade: 'linked',
            levelsPerSide: Gate.BOOK_LEVELS,
            publishIntervalMs: 100,
            clock: 'venue',
        },
        tape: {
            siding: 'sided',
            clock: 'venue',
            hasStableIds: true,
        },
        bars: {
            rungs: [...Gate.WIDTH_NAMES.keys()].map((widthMs) => ({
                widthMs,
                anchorMs: widthMs === 7 * DAY_MS ? Gate.MONDAY_MS : 0,
            })),
            barsPerRequest: 1_000,
            hasVolume: true,
            hasBuyVolume: false,
            hasTradeCount: false,
        },
    };

    override planInstruments(from: number): VenueRequest {
        void from;
        return { url: this.address(Gate.REST, '/api/v4/spot/currency_pairs') };
    }

    override readInstruments(payload: unknown): readonly VenueInstrument[] {
        return this.requireList(payload)
            .map((listed) => this.readInstrument(listed))
            .filter((instrument) => instrument !== null);
    }

    override planStream(symbol: string): VenueStreamPlan {
        return {
            url: Gate.SOCKET,
            // The venue's own examples stamp each subscription with the second
            // it was sent. Left out because a connector holds no clock, and the
            // venue accepts the subscription without it.
            greetings: [
                JSON.stringify({
                    channel: 'spot.order_book_update',
                    event: 'subscribe',
                    payload: [symbol, '100ms'],
                }),
                JSON.stringify({
                    channel: 'spot.trades',
                    event: 'subscribe',
                    payload: [symbol],
                }),
            ],
            heartbeat: { everyMs: 20_000, send: JSON.stringify({ channel: 'spot.ping' }) },
        };
    }

    override planSnapshot(symbol: string): VenueRequest {
        return {
            url: this.address(Gate.REST, '/api/v4/spot/order_book', {
                currency_pair: symbol,
                limit: Gate.BOOK_LEVELS,
                with_id: 'true',
            }),
        };
    }

    override readSnapshot(payload: unknown): DepthSnapshot {
        const lastUpdateId = this.readNumber((payload as Record<string, unknown>)['id']);
        if (lastUpdateId === null) {
            throw new Error('The venue answered with an unreadable ladder.');
        }

        return {
            lastUpdateId,
            bidLevels: this.requireList(payload, 'bids') as readonly SerializedPriceLevel[],
            askLevels: this.requireList(payload, 'asks') as readonly SerializedPriceLevel[],
        };
    }

    override readUpdate(payload: unknown): DepthDiff | null {
        const message = payload as { channel?: unknown; event?: unknown; result?: Record<string, unknown> };
        if (message.channel !== 'spot.order_book_update' || message.event !== 'update') {
            return null;
        }

        const first = this.readNumber(message.result?.['U']);
        const final = this.readNumber(message.result?.['u']);
        if (first === null || final === null
            || !Array.isArray(message.result?.['b']) || !Array.isArray(message.result['a'])) {
            return null;
        }

        return {
            firstUpdateId: first,
            finalUpdateId: final,
            previousFinalUpdateId: first - 1,
            bidLevels: message.result['b'] as readonly SerializedPriceLevel[],
            askLevels: message.result['a'] as readonly SerializedPriceLevel[],
        };
    }

    override readTrades(payload: unknown): readonly ExecutedTrade[] {
        const message = payload as { channel?: unknown; event?: unknown; result?: Record<string, unknown> };
        if (message.channel !== 'spot.trades' || message.event !== 'update') {
            return [];
        }

        const executedAtMs = this.readNumber(message.result?.['create_time_ms']);
        const price = this.readNumber(message.result?.['price']);
        const quantity = this.readNumber(message.result?.['amount']);
        if (executedAtMs === null || price === null || quantity === null) {
            return [];
        }

        return [{
            executedAtMs,
            price,
            quantity,
            // The side named is the side that crossed the spread.
            isAggressorSelling: message.result?.['side'] === 'sell',
        }];
    }

    override planBars(request: BarPageRequest): VenueRequest {
        const interval = Gate.WIDTH_NAMES.get(request.widthMs);
        if (interval === undefined) {
            throw new Error(`No venue candle of width ${String(request.widthMs)}ms`);
        }

        return {
            url: this.address(Gate.REST, '/api/v4/spot/candlesticks', {
                currency_pair: request.symbol,
                interval,
                // Seconds here, milliseconds everywhere else on this venue.
                from: Math.floor(request.fromMs / SECOND_MS),
                to: Math.floor(request.toMs / SECOND_MS),
            }),
        };
    }

    override readBars(payload: unknown, request: BarPageRequest): readonly VenueBar[] {
        return this.requireList(payload)
            .map((row) => this.readCandle(row, request.widthMs))
            .filter((bar) => bar !== null);
    }

    /**
     * One listing, or null where the venue named something the chart cannot draw.
     */
    private readInstrument(listed: unknown): VenueInstrument | null {
        const entry = listed as Record<string, unknown>;
        const symbol = entry['id'];
        const base = entry['base'];
        const quote = entry['quote'];
        if (typeof symbol !== 'string' || typeof base !== 'string' || typeof quote !== 'string') {
            return null;
        }

        // Named as a count of decimals rather than as the step itself, which is
        // the one place this venue asks for arithmetic instead of a reading.
        const decimals = this.readNumber(entry['precision']);
        return {
            symbol,
            base,
            quote,
            priceStep: decimals === null ? 0 : 10 ** -decimals,
            isTrading: entry['trade_status'] === 'tradable',
        };
    }

    /**
     * One candle out of the tuple, or null where a field is unreadable.
     */
    private readCandle(row: unknown, widthMs: number): VenueBar | null {
        if (!Array.isArray(row) || row.length < Gate.CANDLE_FIELDS) {
            return null;
        }

        const openedAtSeconds = this.readNumber(row[Gate.OPENED_AT]);
        const closePrice = this.readNumber(row[Gate.CLOSE_PRICE]);
        if (openedAtSeconds === null || closePrice === null) {
            return null;
        }

        const openedAtMs = openedAtSeconds * SECOND_MS;
        return {
            openedAtMs,
            closedAtMs: openedAtMs + widthMs,
            openPrice: this.readNumber(row[Gate.OPEN_PRICE]) ?? closePrice,
            highPrice: this.readNumber(row[Gate.HIGH_PRICE]) ?? closePrice,
            lowPrice: this.readNumber(row[Gate.LOW_PRICE]) ?? closePrice,
            closePrice,
            // In the base currency, which is the one the chart counts in.
            volume: this.readNumber(row[Gate.BASE_VOLUME]),
            buyVolume: null,
            tradeCount: null,
        };
    }
}

/** The one instance of it, as the engine holds it. */
export const GATE_CONNECTOR: VenueConnector = new Gate();

/** What this venue is registered under. */
export const GATE_ID = 'gate';
