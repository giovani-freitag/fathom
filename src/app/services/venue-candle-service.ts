import { BAR_BUDGET, keepNewestBars, type PriceBar, type PriceBarQuery, type PriceBarWindow } from '../../shared/core/price-bar.ts';
import pMap from 'p-map';
import type { VenueBar, VenueConnector } from '../../shared/core/venue-connector.ts';
import type { VenueGateway } from '../../shared/venues/venue-gateway.ts';

/**
 * Pages of candles in the air at once, past the first.
 *
 * A venue that serves a hundred bars a request needs twenty of them to fill the
 * budget, and asked one after the other that is twenty round trips a reader
 * waits through before the chart draws anything at all.
 */
const PAGES_AT_ONCE = 4;

export interface VenueCandleServiceConfig {
    /** What the venue can do, and how to read what it answers. */
    readonly connector: VenueConnector;
    /** Performs what the connector describes. */
    readonly gateway: VenueGateway;
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
 *
 * The paging, the budget and the clock live here; which URL to ask and how to
 * read the answer live in the connector. That is the whole division: a venue
 * this build has never seen needs no change to anything in this file.
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
     * @throws Error when the venue serves no candle of that width, refuses, or
     *         answers with something the connector cannot read.
     */
    async fetchPriceBars(query: PriceBarQuery, signal?: AbortSignal): Promise<PriceBarWindow> {
        if (this.config.connector.declaration.bars === null) {
            throw new Error('This venue serves no candles');
        }

        const fromMs = query.fromMs - query.warmupBars * query.intervalMs;
        const bars = await this.fetchRange({ fromMs, toMs: query.toMs, query }, signal);
        return {
            instrumentSymbol: query.symbol,
            intervalMs: query.intervalMs,
            warmupBarsRequested: query.warmupBars,
            warmupBarsReturned: bars.filter((bar) => bar.openedAtMs < query.fromMs).length,
            bars,
        };
    }

    /**
     * The range, read newest page first and then the rest of it at once.
     *
     * The newest page alone tells the engine two things: what the reader is
     * looking at, and whether the venue has any more to give. Where it does,
     * every remaining page has an address already — a window is a width and a
     * count — so they go out together rather than each waiting for the one in
     * front of it to name where it ends.
     */
    private async fetchRange(request: RangeRequest, signal?: AbortSignal): Promise<PriceBar[]> {
        const perRequest = this.config.connector.declaration.bars?.barsPerRequest ?? BAR_BUDGET.maximumBars;
        const span = perRequest * request.query.intervalMs;

        const newest = await this.fetchPage({ request, fromMs: Math.max(request.fromMs, request.toMs - span), toMs: request.toMs, perRequest }, signal);
        // A page short of what one request holds is the venue saying it has no
        // more, and the pages behind it would all come back empty.
        if (newest.length < perRequest) {
            return this.settle(newest, request);
        }

        const older = await pMap(
            this.windowsBefore(request, span, perRequest),
            async (window) => this.fetchPage({ request, ...window, perRequest }, signal),
            { concurrency: PAGES_AT_ONCE, ...signal === undefined ? {} : { signal } },
        );

        return this.settle([...older.flat(), ...newest], request);
    }

    /**
     * Every window behind the newest one, up to what the budget will hold.
     */
    private windowsBefore(
        request: RangeRequest,
        span: number,
        perRequest: number,
    ): readonly { readonly fromMs: number; readonly toMs: number }[] {
        const windows: { fromMs: number; toMs: number }[] = [];
        const pages = Math.ceil(BAR_BUDGET.maximumBars / perRequest);

        for (let toMs = request.toMs - span; toMs > request.fromMs && windows.length < pages; toMs -= span) {
            windows.push({ fromMs: Math.max(request.fromMs, toMs - span), toMs });
        }
        return windows;
    }

    /**
     * The pages as one run: in order, once each, and inside what was asked for.
     *
     * Deduplicated because windows that meet at an edge are two requests that
     * both hold the bar on it, and a bar counted twice is a volume counted
     * twice by every reading that walks the run.
     */
    private settle(pages: readonly PriceBar[], request: RangeRequest): PriceBar[] {
        const held = new Map<number, PriceBar>();
        for (const bar of pages) {
            if (bar.openedAtMs >= request.fromMs && bar.openedAtMs < request.toMs) {
                held.set(bar.openedAtMs, bar);
            }
        }

        return keepNewestBars([...held.values()].sort((one, other) => one.openedAtMs - other.openedAtMs));
    }

    /**
     * One request's worth of candles, covering one window of the range.
     */
    private async fetchPage(page: PageRequest, signal?: AbortSignal): Promise<PriceBar[]> {
        const { connector } = this.config;
        const asked = {
            symbol: page.request.query.symbol,
            widthMs: page.request.query.intervalMs,
            fromMs: page.fromMs,
            toMs: page.toMs,
            limit: page.perRequest,
        };

        const payload = await this.config.gateway.perform(connector.planBars(asked), signal);
        return connector.readBars(payload, asked).map((bar) => this.toPriceBar(bar, asked.widthMs));
    }

    /**
     * Fills in what only the engine knows: the split it is allowed to claim,
     * and whether the bar has closed.
     */
    private toPriceBar(bar: VenueBar, intervalMs: number): PriceBar {
        const volume = bar.volume ?? 0;
        // Zero rather than half: a venue that publishes no split has not said
        // the sides were even, and drawing them even is the invention the whole
        // declaration exists to prevent. A reading that needs the split is out
        // of reach on this venue and never sees these figures.
        const buyVolume = bar.buyVolume ?? 0;

        return {
            openedAtMs: bar.openedAtMs,
            // The connector's own edge unless it left one at the open, which is
            // how a venue that names only where a candle starts says so.
            closedAtMs: bar.closedAtMs > bar.openedAtMs ? bar.closedAtMs : bar.openedAtMs + intervalMs,
            openPrice: bar.openPrice,
            highPrice: bar.highPrice,
            lowPrice: bar.lowPrice,
            closePrice: bar.closePrice,
            buyVolume,
            sellVolume: Math.max(0, volume - buyVolume),
            tradeCount: bar.tradeCount ?? 0,
            // A venue candle covers the whole of its own width, whatever this
            // chart happened to record of it. Whether the book was recorded
            // through it is a different fact, drawn from the gap ledger.
            expectedFrames: 1,
            frameCount: 1,
            isClosed: bar.openedAtMs + intervalMs <= this.config.readNowMs(),
            firstFrameAtMs: bar.openedAtMs,
            lastFrameAtMs: bar.openedAtMs + intervalMs,
        };
    }
}

interface RangeRequest {
    readonly fromMs: number;
    readonly toMs: number;
    readonly query: PriceBarQuery;
}

interface PageRequest {
    readonly request: RangeRequest;
    /** The window this page covers, which is one request's worth of the range. */
    readonly fromMs: number;
    readonly toMs: number;
    readonly perRequest: number;
}
