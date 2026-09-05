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
 * Kraken's spot market: a past and a tape, and no book.
 *
 * The third kind of absence, and the one worth reading the contract against.
 * This venue publishes its book and checks it with a checksum over the top ten
 * levels rather than with a sequence number. Fathom's mirror joins updates by
 * their numbering, and a run of updates with no numbers cannot be joined at
 * all — there is nothing to say one arrived out of order or not at all.
 *
 * Its listing is the other shape worth having: an object keyed by pair rather
 * than a list of them, which is why nothing here reaches for `requireList`.
 */
class Kraken extends Connector {
    private static readonly REST = 'https://api.kraken.com';

    private static readonly SOCKET = 'wss://ws.kraken.com/v2';

    /** What the venue calls each width it serves candles at, in minutes. */
    private static readonly WIDTHS = new Map<number, number>([
        [MINUTE_MS, 1],
        [5 * MINUTE_MS, 5],
        [15 * MINUTE_MS, 15],
        [30 * MINUTE_MS, 30],
        [HOUR_MS, 60],
        [4 * HOUR_MS, 240],
        [DAY_MS, 1_440],
        [7 * DAY_MS, 10_080],
    ]);

    /** A candle as the wire sends it, with the venue's own average in the middle. */
    private static readonly OPENED_AT = 0;
    private static readonly OPEN_PRICE = 1;
    private static readonly HIGH_PRICE = 2;
    private static readonly LOW_PRICE = 3;
    private static readonly CLOSE_PRICE = 4;
    private static readonly VOLUME = 6;
    private static readonly TRADE_COUNT = 7;

    /** How many fields a candle must have before it is worth reading. */
    private static readonly CANDLE_FIELDS = 8;

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
            rungs: [...Kraken.WIDTHS.keys()].map((widthMs) => ({
                widthMs,
                anchorMs: widthMs === 7 * DAY_MS ? Kraken.MONDAY_MS : 0,
            })),
            barsPerRequest: 720,
            hasVolume: true,
            hasBuyVolume: false,
            // The one venue here besides the shipped one that counts its prints.
            hasTradeCount: true,
        },
    };

    override planInstruments(from: number): VenueRequest {
        void from;
        return { url: this.address(Kraken.REST, '/0/public/AssetPairs') };
    }

    override readInstruments(payload: unknown): readonly VenueInstrument[] {
        const listed = (payload as { result?: unknown }).result;
        if (typeof listed !== 'object' || listed === null) {
            throw new Error('The venue answered with no pairs under “result”.');
        }

        return Object.values(listed as Record<string, unknown>)
            .map((entry) => this.readInstrument(entry))
            .filter((instrument) => instrument !== null);
    }

    override planStream(symbol: string): VenueStreamPlan {
        return {
            url: Kraken.SOCKET,
            greetings: [JSON.stringify({
                method: 'subscribe',
                params: { channel: 'trade', symbol: [symbol] },
            })],
            heartbeat: { everyMs: 20_000, send: JSON.stringify({ method: 'ping' }) },
        };
    }

    override readTrades(payload: unknown): readonly ExecutedTrade[] {
        const message = payload as { channel?: unknown; data?: unknown };
        if (message.channel !== 'trade') {
            return [];
        }

        return (Array.isArray(message.data) ? message.data : [])
            .map((print) => this.readTrade(print))
            .filter((trade) => trade !== null);
    }

    override planBars(request: BarPageRequest): VenueRequest {
        const interval = Kraken.WIDTHS.get(request.widthMs);
        if (interval === undefined) {
            throw new Error(`No venue candle of width ${String(request.widthMs)}ms`);
        }

        return {
            url: this.address(Kraken.REST, '/0/public/OHLC', {
                pair: request.symbol,
                interval,
                // The one edge this venue takes. What comes back runs forward
                // from here, however far past the window that reaches.
                since: Math.floor(request.fromMs / SECOND_MS),
            }),
        };
    }

    override readBars(payload: unknown, request: BarPageRequest): readonly VenueBar[] {
        const held = (payload as { result?: Record<string, unknown> }).result;
        // Keyed by the venue's own name for the pair, which is not the name it
        // was asked by: XBTUSD is answered under XXBTZUSD. The one entry that is
        // not a run of candles is the cursor it offers for the next call.
        const run = Object.entries(held ?? {})
            .find(([name, value]) => name !== 'last' && Array.isArray(value))?.[1];
        if (!Array.isArray(run)) {
            throw new Error('The venue answered with no candles under “result”.');
        }

        return run
            .map((row) => this.readCandle(row, request.widthMs))
            .filter((bar) => bar !== null)
            // Trimmed here because the venue was given no closing edge: without
            // it a window of an hour comes back with the twelve after it too.
            .filter((bar) => bar.openedAtMs < request.toMs);
    }

    /**
     * One listing, or null where the venue named something the chart cannot draw.
     */
    private readInstrument(entry: unknown): VenueInstrument | null {
        const pair = entry as Record<string, unknown>;
        const symbol = pair['altname'];
        const named = pair['wsname'];
        if (typeof symbol !== 'string' || typeof named !== 'string') {
            return null;
        }

        // The pair as a person writes it, which is the only place this venue
        // spells the two assets without its own prefixes.
        const [base, quote] = named.split('/');
        if (base === undefined || quote === undefined) {
            return null;
        }

        const decimals = this.readNumber(pair['pair_decimals']);
        return {
            symbol,
            base,
            quote,
            priceStep: decimals === null ? 0 : 10 ** -decimals,
            isTrading: pair['status'] === 'online',
        };
    }

    /**
     * One print off the stream, or null where a field is unreadable.
     */
    private readTrade(print: unknown): ExecutedTrade | null {
        const entry = print as Record<string, unknown>;
        const price = this.readNumber(entry['price']);
        const quantity = this.readNumber(entry['qty']);
        const stamp = entry['timestamp'];
        if (price === null || quantity === null || typeof stamp !== 'string') {
            return null;
        }

        const executedAtMs = Date.parse(stamp);
        if (!Number.isFinite(executedAtMs)) {
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
        if (!Array.isArray(row) || row.length < Kraken.CANDLE_FIELDS) {
            return null;
        }

        const openedAtSeconds = this.readNumber(row[Kraken.OPENED_AT]);
        const closePrice = this.readNumber(row[Kraken.CLOSE_PRICE]);
        if (openedAtSeconds === null || closePrice === null) {
            return null;
        }

        const openedAtMs = openedAtSeconds * SECOND_MS;
        return {
            openedAtMs,
            closedAtMs: openedAtMs + widthMs,
            openPrice: this.readNumber(row[Kraken.OPEN_PRICE]) ?? closePrice,
            highPrice: this.readNumber(row[Kraken.HIGH_PRICE]) ?? closePrice,
            lowPrice: this.readNumber(row[Kraken.LOW_PRICE]) ?? closePrice,
            closePrice,
            volume: this.readNumber(row[Kraken.VOLUME]),
            buyVolume: null,
            tradeCount: this.readNumber(row[Kraken.TRADE_COUNT]),
        };
    }
}

/** The one instance of it, as the engine holds it. */
export const KRAKEN_CONNECTOR: VenueConnector = new Kraken();

/** What this venue is registered under. */
export const KRAKEN_ID = 'kraken';
