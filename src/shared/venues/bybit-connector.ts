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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Bybit's perpetuals, which are the second venue this build can read.
 *
 * The one shipped venue that pages its listing, and it pages the harder way:
 * a cursor handed out with each page rather than a total, so the pages can only
 * be walked. It is here for that as much as for the market.
 */
class Bybit extends Connector {
    /** The mark, from the storefront: the API host serves none of its own. */
    override readonly markUrl = 'https://www.bybit.com/favicon.ico';

    private static readonly REST = 'https://api.bybit.com';

    private static readonly SOCKET = 'wss://stream.bybit.com';

    /** Perpetuals settled in a stablecoin, which is what this venue is known for. */
    private static readonly CATEGORY = 'linear';

    /** The longest listing page the venue serves, and the fewest requests for it. */
    private static readonly PER_PAGE = 1_000;

    /**
     * The depth its socket publishes, which the snapshot is asked for as well.
     *
     * Two hundred rather than the five hundred the ladder endpoint will serve:
     * the socket has no handler for a deeper topic, and a mirror seeded deeper
     * than the updates that maintain it keeps rows nothing will ever correct.
     */
    private static readonly BOOK_LEVELS = 200;

    /** What the venue calls each width it serves candles at. */
    private static readonly WIDTH_NAMES = new Map<number, string>([
        [MINUTE_MS, '1'],
        [3 * MINUTE_MS, '3'],
        [5 * MINUTE_MS, '5'],
        [15 * MINUTE_MS, '15'],
        [30 * MINUTE_MS, '30'],
        [HOUR_MS, '60'],
        [2 * HOUR_MS, '120'],
        [4 * HOUR_MS, '240'],
        [6 * HOUR_MS, '360'],
        [12 * HOUR_MS, '720'],
        [DAY_MS, 'D'],
        [7 * DAY_MS, 'W'],
    ]);

    /** A candle as the wire sends it: seven strings, oldest field first. */
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
        book: {
            // Each message carries the update after the last, so a gap is a
            // number that skipped rather than something only a checksum knows.
            grade: 'linked',
            levelsPerSide: Bybit.BOOK_LEVELS,
            publishIntervalMs: 100,
            clock: 'venue',
        },
        tape: {
            siding: 'sided',
            clock: 'venue',
            hasStableIds: true,
        },
        bars: {
            rungs: [...Bybit.WIDTH_NAMES.keys()].map((widthMs) => ({
                widthMs,
                anchorMs: widthMs === 7 * DAY_MS ? Bybit.MONDAY_MS : 0,
            })),
            barsPerRequest: 1_000,
            hasVolume: true,
            hasBuyVolume: false,
            hasTradeCount: false,
        },
    };

    override planInstruments(from: number): VenueRequest {
        void from;
        return {
            url: this.address(Bybit.REST, '/v5/market/instruments-info', {
                category: Bybit.CATEGORY,
                limit: Bybit.PER_PAGE,
            }),
        };
    }

    override readInstruments(payload: unknown): readonly VenueInstrument[] {
        return this.readResult(payload, 'list')
            .map((listed) => this.readInstrument(listed))
            .filter((instrument) => instrument !== null);
    }

    /**
     * The next page, which this venue names with a cursor rather than a count.
     */
    override continueInstruments(payload: unknown, read: number): VenueRequest | null {
        void read;
        const cursor = (payload as { result?: { nextPageCursor?: unknown } }).result?.nextPageCursor;
        if (typeof cursor !== 'string' || cursor === '') {
            return null;
        }

        return {
            url: this.address(Bybit.REST, '/v5/market/instruments-info', {
                category: Bybit.CATEGORY,
                limit: Bybit.PER_PAGE,
                cursor,
            }),
        };
    }

    override planStream(symbol: string): VenueStreamPlan {
        return {
            url: `${Bybit.SOCKET}/v5/public/${Bybit.CATEGORY}`,
            greetings: [JSON.stringify({
                op: 'subscribe',
                args: [`orderbook.${String(Bybit.BOOK_LEVELS)}.${symbol}`, `publicTrade.${symbol}`],
            })],
            // The venue closes a socket nothing has said anything on for twenty
            // seconds, replayed prints and all.
            heartbeat: { everyMs: 20_000, send: JSON.stringify({ op: 'ping' }) },
        };
    }

    override planSnapshot(symbol: string): VenueRequest {
        return {
            url: this.address(Bybit.REST, '/v5/market/orderbook', {
                category: Bybit.CATEGORY,
                symbol,
                limit: Bybit.BOOK_LEVELS,
            }),
        };
    }

    override readSnapshot(payload: unknown): DepthSnapshot {
        const result = (payload as { result?: Record<string, unknown> }).result;
        const lastUpdateId = this.readNumber(result?.['u']);
        if (lastUpdateId === null) {
            throw new Error('The venue answered with an unreadable ladder.');
        }

        return {
            lastUpdateId,
            bidLevels: this.requireList(result, 'b') as readonly SerializedPriceLevel[],
            askLevels: this.requireList(result, 'a') as readonly SerializedPriceLevel[],
        };
    }

    override readUpdate(payload: unknown): DepthDiff | null {
        const message = payload as { topic?: unknown; type?: unknown; data?: Record<string, unknown> };
        // The venue opens with a snapshot of its own and then sends deltas. The
        // mirror is seeded from the ladder it fetched, so a second snapshot is
        // not a change and is left where it lies.
        if (typeof message.topic !== 'string' || !message.topic.startsWith('orderbook.')
            || message.type !== 'delta') {
            return null;
        }

        const update = this.readNumber(message.data?.['u']);
        if (update === null || !Array.isArray(message.data?.['b']) || !Array.isArray(message.data['a'])) {
            return null;
        }

        return {
            firstUpdateId: update,
            finalUpdateId: update,
            // One past the last, which is what this venue's numbering means.
            previousFinalUpdateId: update - 1,
            bidLevels: message.data['b'] as readonly SerializedPriceLevel[],
            askLevels: message.data['a'] as readonly SerializedPriceLevel[],
        };
    }

    override readTrades(payload: unknown): readonly ExecutedTrade[] {
        const message = payload as { topic?: unknown; data?: unknown };
        if (typeof message.topic !== 'string' || !message.topic.startsWith('publicTrade.')) {
            return [];
        }

        return (Array.isArray(message.data) ? message.data : [])
            .map((print) => this.readTrade(print))
            .filter((trade) => trade !== null);
    }

    override planBars(request: BarPageRequest): VenueRequest {
        const interval = Bybit.WIDTH_NAMES.get(request.widthMs);
        if (interval === undefined) {
            throw new Error(`No venue candle of width ${String(request.widthMs)}ms`);
        }

        return {
            url: this.address(Bybit.REST, '/v5/market/kline', {
                category: Bybit.CATEGORY,
                symbol: request.symbol,
                interval,
                start: Math.floor(request.fromMs),
                end: Math.floor(request.toMs),
                limit: request.limit,
            }),
        };
    }

    override readBars(payload: unknown, request: BarPageRequest): readonly VenueBar[] {
        return this.readResult(payload, 'list')
            .map((row) => this.readCandle(row, request.widthMs))
            .filter((bar) => bar !== null)
            // Newest first on the wire, and every reading downstream walks bars
            // forwards.
            .reverse();
    }

    /**
     * A list under the venue's own envelope, which every answer here carries.
     */
    private readResult(payload: unknown, at: string): readonly unknown[] {
        return this.requireList((payload as { result?: unknown }).result, at);
    }

    /**
     * One listing, or null where the venue named something the chart cannot draw.
     */
    private readInstrument(listed: unknown): VenueInstrument | null {
        const entry = listed as Record<string, unknown>;
        const symbol = entry['symbol'];
        const base = entry['baseCoin'];
        const quote = entry['quoteCoin'];
        if (typeof symbol !== 'string' || typeof base !== 'string' || typeof quote !== 'string') {
            return null;
        }

        const filter = entry['priceFilter'] as Record<string, unknown> | undefined;
        return {
            symbol,
            base,
            quote,
            priceStep: this.readNumber(filter?.['tickSize']) ?? 0,
            isTrading: entry['status'] === 'Trading',
        };
    }

    /**
     * One print off the stream, or null where a field is unreadable.
     */
    private readTrade(print: unknown): ExecutedTrade | null {
        const entry = print as Record<string, unknown>;
        const executedAtMs = this.readNumber(entry['T']);
        const price = this.readNumber(entry['p']);
        const quantity = this.readNumber(entry['v']);
        if (executedAtMs === null || price === null || quantity === null) {
            return null;
        }

        return {
            executedAtMs,
            price,
            quantity,
            // The side named is the side that crossed the spread.
            isAggressorSelling: entry['S'] === 'Sell',
        };
    }

    /**
     * One candle out of the tuple, or null where a field is unreadable.
     */
    private readCandle(row: unknown, widthMs: number): VenueBar | null {
        if (!Array.isArray(row) || row.length < Bybit.CANDLE_FIELDS) {
            return null;
        }

        const openedAtMs = this.readNumber(row[Bybit.OPENED_AT]);
        const closePrice = this.readNumber(row[Bybit.CLOSE_PRICE]);
        if (openedAtMs === null || closePrice === null) {
            return null;
        }

        return {
            openedAtMs,
            // The venue names only where a candle opens, and the width it was
            // asked for is what turns that into the first instant it does not
            // hold.
            closedAtMs: openedAtMs + widthMs,
            openPrice: this.readNumber(row[Bybit.OPEN_PRICE]) ?? closePrice,
            highPrice: this.readNumber(row[Bybit.HIGH_PRICE]) ?? closePrice,
            lowPrice: this.readNumber(row[Bybit.LOW_PRICE]) ?? closePrice,
            closePrice,
            volume: this.readNumber(row[Bybit.VOLUME]),
            buyVolume: null,
            tradeCount: null,
        };
    }
}

/** The one instance of it, as the engine holds it. */
export const BYBIT_CONNECTOR: VenueConnector = new Bybit();

/** What this venue is registered under. */
export const BYBIT_ID = 'bybit';
