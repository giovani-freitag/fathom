import { BINANCE_CONNECTOR } from '../../../../src/shared/venues/binance-connector.ts';
import { VenueGateway } from '../../../../src/shared/venues/venue-gateway.ts';
import { describe, expect, it, vi } from 'vitest';
import type { PriceBarQuery } from '../../../../src/shared/core/price-bar.ts';
import { VenueCandleService } from '../../../../src/app/services/venue-candle-service.ts';

const MINUTE_MS = 60_000;
const NOW_MS = 10_000_000;

/** One candle as the venue sends it: a tuple of strings and numbers. */
function buildCandle(openedAtMs: number, close = '100'): unknown[] {
    return [
        openedAtMs, '99', '101', '98', close, '5',
        openedAtMs + MINUTE_MS - 1, '400', 7, '3', '240', '0',
    ];
}

interface Answered {
    readonly urls: string[];
}

function buildService(pages: unknown[][], answered: Answered = { urls: [] }): VenueCandleService {
    let page = 0;
    const fetch = vi.fn((input: URL | RequestInfo) => {
        answered.urls.push(typeof input === 'string' ? input : '');
        const body = pages[Math.min(page, pages.length - 1)] ?? [];
        page += 1;
        return Promise.resolve(new Response(JSON.stringify(body)));
    }) as unknown as typeof globalThis.fetch;

    return new VenueCandleService({
        connector: BINANCE_CONNECTOR,
        gateway: new VenueGateway({ fetch }),
        readNowMs: () => NOW_MS,
    });
}

const QUERY: PriceBarQuery = {
    symbol: 'BTCUSDT',
    fromMs: 1_000_000,
    toMs: 1_000_000 + MINUTE_MS * 3,
    intervalMs: MINUTE_MS,
    warmupBars: 0,
};

describe('VenueCandleService', () => {
    it('reads the candles the venue published', async () => {
        const service = buildService([[buildCandle(1_000_000), buildCandle(1_000_000 + MINUTE_MS)]]);

        const window = await service.fetchPriceBars(QUERY);

        expect(window.bars).toHaveLength(2);
    });

    it('reads what a candle opened, reached and closed at', async () => {
        const service = buildService([[buildCandle(1_000_000)]]);

        const bar = (await service.fetchPriceBars(QUERY)).bars[0]!;

        expect([bar.openPrice, bar.highPrice, bar.lowPrice, bar.closePrice]).toEqual([99, 101, 98, 100]);
    });

    it('splits the volume by which side crossed the spread', async () => {
        // The venue reports what the taker bought; the rest of the volume is
        // what the taker sold, which is the split the bubbles are drawn from.
        const service = buildService([[buildCandle(1_000_000)]]);

        const bar = (await service.fetchPriceBars(QUERY)).bars[0]!;

        expect([bar.buyVolume, bar.sellVolume]).toEqual([3, 2]);
    });

    it('counts a closed candle as whole, whatever this chart recorded of it', async () => {
        // The venue saw the whole minute. Whether the book was recorded through
        // it is a different fact, drawn from the gap ledger.
        const service = buildService([[buildCandle(1_000_000)]]);

        const bar = (await service.fetchPriceBars(QUERY)).bars[0]!;

        expect([bar.isClosed, bar.frameCount, bar.expectedFrames]).toEqual([true, 1, 1]);
    });

    it('leaves the candle still forming open', async () => {
        const service = buildService([[buildCandle(NOW_MS)]]);

        const bar = (await service.fetchPriceBars({ ...QUERY, toMs: NOW_MS + MINUTE_MS })).bars[0]!;

        expect(bar.isClosed).toBe(false);
    });

    it('asks for the warm-up ahead of the range, which costs rows and not columns', async () => {
        const answered: Answered = { urls: [] };
        const service = buildService([[buildCandle(1_000_000 - MINUTE_MS), buildCandle(1_000_000)]], answered);

        await service.fetchPriceBars({ ...QUERY, warmupBars: 1 });

        expect(answered.urls[0]).toContain(`startTime=${String(1_000_000 - MINUTE_MS)}`);
    });

    it('says how much of the warm-up it got, so a reading knows it is converging', async () => {
        const service = buildService([[buildCandle(1_000_000 - MINUTE_MS), buildCandle(1_000_000)]]);

        const window = await service.fetchPriceBars({ ...QUERY, warmupBars: 1 });

        expect(window.warmupBarsReturned).toBe(1);
    });

    it('asks the venue for the width the chart is drawing', async () => {
        const answered: Answered = { urls: [] };
        const service = buildService([[buildCandle(1_000_000)]], answered);

        await service.fetchPriceBars({ ...QUERY, intervalMs: 900_000 });

        expect(answered.urls[0]).toContain('interval=15m');
    });

    it('refuses a width no venue publishes rather than asking for one', async () => {
        const answered: Answered = { urls: [] };
        const service = buildService([[]], answered);

        await expect(service.fetchPriceBars({ ...QUERY, intervalMs: 1_000 })).rejects.toThrow();
        expect(answered.urls).toEqual([]);
    });

    it('refuses an answer the venue would not stand behind', async () => {
        const refusing = (() => Promise.resolve(new Response('{}', { status: 418 }))) as typeof globalThis.fetch;
        const service = new VenueCandleService({
            connector: BINANCE_CONNECTOR,
            gateway: new VenueGateway({ fetch: refusing }),
            readNowMs: () => NOW_MS,
        });

        await expect(service.fetchPriceBars(QUERY)).rejects.toThrow('418');
    });

    it('drops a candle it cannot read rather than drawing a bar out of nothing', async () => {
        const service = buildService([[buildCandle(1_000_000), ['nonsense']]]);

        expect((await service.fetchPriceBars(QUERY)).bars).toHaveLength(1);
    });

    it('stops asking once the venue answers with less than it could have', async () => {
        const answered: Answered = { urls: [] };
        const service = buildService([[buildCandle(1_000_000)]], answered);

        await service.fetchPriceBars(QUERY);

        expect(answered.urls).toHaveLength(1);
    });
});

/** A venue that publishes an open instant, a total, and nothing else. */
function buildOpenOnlyService(): VenueCandleService {
    return new VenueCandleService({
        connector: Object.assign(Object.create(BINANCE_CONNECTOR) as typeof BINANCE_CONNECTOR, {
            planBars: () => ({ url: 'https://venue.example/candles' }),
            readBars: () => [{
                openedAtMs: 1_000_000,
                closedAtMs: 1_000_000,
                openPrice: 99, highPrice: 101, lowPrice: 98, closePrice: 100,
                volume: 5, buyVolume: null, tradeCount: null,
            }],
        }),
        gateway: new VenueGateway({ fetch: () => Promise.resolve(new Response('[]')) }),
        readNowMs: () => NOW_MS,
    });
}

describe('a venue that names only where a candle opens', () => {
    it('closes the bar where the next one starts', async () => {
        // Most venues publish the open instant and nothing else, and a bar with
        // no edge is one every later read has to guess the width of.
        const window = await buildOpenOnlyService().fetchPriceBars(QUERY);

        expect(window.bars[0]?.closedAtMs).toBe(1_000_000 + MINUTE_MS);
    });

    it('reads a venue that publishes no split as no split, not as an even one', async () => {
        // Half each is a claim that buying and selling were even, and it reads
        // exactly like the truth. Any reading that would divide by the split is
        // out of reach on such a venue and never sees these figures.
        const service = buildOpenOnlyService();

        const window = await service.fetchPriceBars(QUERY);

        expect(window.bars[0]?.buyVolume).toBe(0);
        expect(window.bars[0]?.sellVolume).toBe(5);
    });
});

/**
 * A venue that serves two candles a request, and says so.
 *
 * Two because the shape being tested is the paging rather than the volume: a
 * range of six candles is three requests here, which is what a hundred-bar
 * venue does to a two-thousand-bar budget on a real chart.
 */
function buildPagedService(watch: { asked: string[]; startedWhenFirstLanded: number }): VenueCandleService {
    const perRequest = 2;
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
        // The gateway fetches by address, never by `Request`, so the one shape
        // this ever sees is the string the connector named.
        const url = new URL(input as string);
        watch.asked.push(url.href);
        // The newest window is fetched on its own; the ones behind it go out
        // together, and this waits long enough for that to be visible.
        const isNewest = url.searchParams.get('endTime') === String(QUERY.fromMs + MINUTE_MS * 6);
        await new Promise((wake) => { setTimeout(wake, isNewest ? 0 : 30); });
        if (!isNewest && watch.startedWhenFirstLanded === 0) {
            watch.startedWhenFirstLanded = watch.asked.length;
        }

        const fromMs = Number(url.searchParams.get('startTime'));
        const body = Array.from({ length: perRequest }, (_, at) => buildCandle(fromMs + at * MINUTE_MS));
        return new Response(JSON.stringify(body));
    }) as unknown as typeof globalThis.fetch;

    return new VenueCandleService({
        connector: Object.assign(Object.create(BINANCE_CONNECTOR) as typeof BINANCE_CONNECTOR, {
            declaration: {
                ...BINANCE_CONNECTOR.declaration,
                bars: { ...BINANCE_CONNECTOR.declaration.bars, barsPerRequest: perRequest },
            },
        }),
        gateway: new VenueGateway({ fetch }),
        readNowMs: () => NOW_MS,
    });
}

describe('a venue that serves the range in several pages', () => {
    it('asks for the pages behind the newest one together', async () => {
        // Sequentially, a venue that serves a hundred bars a request is twenty
        // round trips before the chart draws anything.
        const watch = { asked: [] as string[], startedWhenFirstLanded: 0 };
        const service = buildPagedService(watch);

        await service.fetchPriceBars({ ...QUERY, toMs: QUERY.fromMs + MINUTE_MS * 6 });

        expect(watch.asked.length).toBeGreaterThan(2);
        // Every window was in the air by the time the first of them answered.
        expect(watch.startedWhenFirstLanded).toBe(watch.asked.length);
    });

    it('hands back one run, in order and with no bar counted twice', async () => {
        // Windows that meet at an edge are two requests that both hold the bar
        // on it, and a bar counted twice is a volume counted twice by every
        // reading that walks the run.
        const service = buildPagedService({ asked: [], startedWhenFirstLanded: 0 });

        const window = await service.fetchPriceBars({ ...QUERY, toMs: QUERY.fromMs + MINUTE_MS * 6 });

        const opened = window.bars.map((bar) => bar.openedAtMs);
        expect(opened).toEqual([...new Set(opened)].sort((one, other) => one - other));
        expect(window.bars.length).toBeGreaterThan(2);
    });
});
