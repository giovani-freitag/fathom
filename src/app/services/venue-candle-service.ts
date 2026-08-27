import { BAR_BUDGET, type PriceBar, type PriceBarQuery, type PriceBarWindow } from '../../shared/core/price-bar.ts';
import { nameVenueInterval } from '../../shared/core/venue-bar-interval.ts';

/** Candles one request may return, which is the venue's own cap. */
const CANDLES_PER_REQUEST = 1_500;

/**
 * A venue's candle, as the wire sends it: a tuple, not an object.
 *
 * Indices rather than names because that is what arrives. Only the first six
 * and the taker split are read; the rest are the venue's own bookkeeping.
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

export interface VenueCandleServiceConfig {
    /** Origin the venue's REST surface is served from. */
    readonly restApiBaseUrl: string;
    /** Injected so a test can answer without a network. */
    readonly fetch: typeof globalThis.fetch;
    /** The instant a still-forming candle is measured against. */
    readonly readNowMs: () => number;
}

/**
 * The candles and the volume, straight from the venue.
 *
 * Fetched rather than recorded, which is the whole point of it: a venue has
 * every past day and the book has only what was recorded, so a chart that drew
 * both from the recording opened on an empty screen and stayed that way until
 * the reader had left it running. The book is what must be recorded; the price
 * that moved through it never was.
 */
export class VenueCandleService {
    private readonly config: VenueCandleServiceConfig;

    constructor(config: VenueCandleServiceConfig) {
        this.config = config;
    }

    /**
     * Bars covering a window, oldest first.
     *
     * @param query - The instrument, the range, the rung, and the warm-up.
     * @param signal - Aborts the fetch when the window it was for has moved on.
     * @returns The bars the venue published, warm-up included at the front.
     * @throws Error when the venue refuses or answers with something unreadable.
     */
    async fetchPriceBars(query: PriceBarQuery, signal?: AbortSignal): Promise<PriceBarWindow> {
        const interval = nameVenueInterval(query.intervalMs);
        if (interval === null) {
            throw new Error(`No venue candle of width ${query.intervalMs}ms`);
        }

        const fromMs = query.fromMs - query.warmupBars * query.intervalMs;
        const bars = await this.fetchRange({ interval, fromMs, toMs: query.toMs, query }, signal);
        return {
            instrumentSymbol: query.symbol,
            intervalMs: query.intervalMs,
            warmupBarsRequested: query.warmupBars,
            warmupBarsReturned: bars.filter((bar) => bar.openedAtMs < query.fromMs).length,
            bars,
        };
    }

    /**
     * Walks back from the end of the range until it is covered or budgeted out.
     *
     * Backwards because the newest end is the one a reader is looking at: a
     * range too wide for the budget should lose its oldest bars, not the price.
     */
    private async fetchRange(request: RangeRequest, signal?: AbortSignal): Promise<PriceBar[]> {
        const collected: PriceBar[][] = [];
        let endMs = request.toMs;
        let held = 0;

        while (endMs > request.fromMs && held < BAR_BUDGET.maximumBars) {
            const page = await this.fetchPage(request, endMs, signal);
            const wanted = page.filter((bar) => bar.openedAtMs >= request.fromMs);
            if (wanted.length === 0) {
                break;
            }

            collected.unshift(wanted);
            held += wanted.length;
            endMs = wanted[0]!.openedAtMs - 1;
            // A page short of the cap is the venue saying it has no more.
            if (page.length < CANDLES_PER_REQUEST) {
                break;
            }
        }

        return collected.flat();
    }

    /**
     * One request's worth of candles, ending at an instant.
     */
    private async fetchPage(
        request: RangeRequest,
        endMs: number,
        signal?: AbortSignal,
    ): Promise<PriceBar[]> {
        const url = new URL('/fapi/v1/klines', this.config.restApiBaseUrl);
        url.searchParams.set('symbol', request.query.symbol);
        url.searchParams.set('interval', request.interval);
        url.searchParams.set('startTime', String(Math.floor(request.fromMs)));
        url.searchParams.set('endTime', String(Math.floor(endMs)));
        url.searchParams.set('limit', String(CANDLES_PER_REQUEST));

        const response = await this.config.fetch(url, signal === undefined ? {} : { signal });
        if (!response.ok) {
            throw new Error(`Venue refused candles with ${String(response.status)}`);
        }

        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) {
            throw new Error('Venue answered candles with something that is not a list');
        }
        return rows
            .map((row) => this.toPriceBar(row, request.query.intervalMs))
            .filter((bar) => bar !== null);
    }

    /**
     * Reads one candle off the wire, or nothing when it cannot be read.
     */
    private toPriceBar(row: unknown, intervalMs: number): PriceBar | null {
        if (!Array.isArray(row) || row.length <= TAKER_BUY_VOLUME) {
            return null;
        }

        const openedAtMs = readNumber(row[OPENED_AT]);
        const closedAtMs = readNumber(row[CLOSED_AT]);
        const volume = readNumber(row[VOLUME]);
        const takerBuyVolume = readNumber(row[TAKER_BUY_VOLUME]);
        if (openedAtMs === null || closedAtMs === null || volume === null || takerBuyVolume === null) {
            return null;
        }

        const prices = [row[OPEN_PRICE], row[HIGH_PRICE], row[LOW_PRICE], row[CLOSE_PRICE]]
            .map(readNumber);
        if (prices.some((price) => price === null)) {
            return null;
        }
        const [openPrice, highPrice, lowPrice, closePrice] = prices as [number, number, number, number];

        return {
            openedAtMs,
            closedAtMs: closedAtMs + 1,
            openPrice,
            highPrice,
            lowPrice,
            closePrice,
            // The venue reports what crossed the spread upward; the rest sold.
            buyVolume: takerBuyVolume,
            sellVolume: Math.max(0, volume - takerBuyVolume),
            tradeCount: readNumber(row[TRADE_COUNT]) ?? 0,
            // A venue candle covers the whole of its own width, whatever this
            // chart happened to record of it. Whether the book was recorded
            // through it is a different fact, drawn from the gap ledger.
            expectedFrames: 1,
            frameCount: 1,
            isClosed: closedAtMs < this.config.readNowMs(),
            firstFrameAtMs: openedAtMs,
            lastFrameAtMs: openedAtMs + intervalMs,
        };
    }
}

interface RangeRequest {
    readonly interval: string;
    readonly fromMs: number;
    readonly toMs: number;
    readonly query: PriceBarQuery;
}

/**
 * Reads a figure the venue sent as a string, as they all are.
 *
 * @param value - Whatever arrived in that position.
 * @returns The number, or null when it is not one.
 */
function readNumber(value: unknown): number | null {
    const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
}
