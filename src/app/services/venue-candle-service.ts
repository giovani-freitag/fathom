import { BAR_BUDGET, type PriceBar, type PriceBarQuery, type PriceBarWindow } from '../../shared/core/price-bar.ts';
import type { VenueBar, VenueConnector } from '../../shared/core/venue-connector.ts';
import type { VenueGateway } from '../../shared/venues/venue-gateway.ts';

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
        const reader = this.config.connector.bars;
        if (reader === null) {
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
     * Walks back from the end of the range until it is covered or budgeted out.
     *
     * Backwards because the newest end is the one a reader is looking at: a
     * range too wide for the budget should lose its oldest bars, not the price.
     */
    private async fetchRange(request: RangeRequest, signal?: AbortSignal): Promise<PriceBar[]> {
        const perRequest = this.config.connector.declaration.bars?.barsPerRequest ?? BAR_BUDGET.maximumBars;
        const collected: PriceBar[][] = [];
        let endMs = request.toMs;
        let held = 0;

        while (endMs > request.fromMs && held < BAR_BUDGET.maximumBars) {
            const page = await this.fetchPage({ request, endMs, perRequest }, signal);
            const wanted = page.filter((bar) => bar.openedAtMs >= request.fromMs);
            if (wanted.length === 0) {
                break;
            }

            collected.unshift(wanted);
            held += wanted.length;
            endMs = wanted[0]!.openedAtMs - 1;
            // A page short of the cap is the venue saying it has no more.
            if (page.length < perRequest) {
                break;
            }
        }

        return collected.flat();
    }

    /**
     * One request's worth of candles, ending at an instant.
     */
    private async fetchPage(page: PageRequest, signal?: AbortSignal): Promise<PriceBar[]> {
        const reader = this.config.connector.bars!;
        const asked = {
            symbol: page.request.query.symbol,
            widthMs: page.request.query.intervalMs,
            fromMs: page.request.fromMs,
            toMs: page.endMs,
            limit: page.perRequest,
        };

        const payload = await this.config.gateway.perform(reader.planPage(asked), signal);
        return reader.readPage(payload, asked).map((bar) => this.toPriceBar(bar, asked.widthMs));
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
    /** The instant this page ends at, walking backwards through the range. */
    readonly endMs: number;
    readonly perRequest: number;
}
