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
        connector: {
            ...BINANCE_CONNECTOR,
            bars: {
                planPage: () => ({ url: 'https://venue.example/candles' }),
                readPage: () => [{
                    openedAtMs: 1_000_000,
                    closedAtMs: 1_000_000,
                    openPrice: 99, highPrice: 101, lowPrice: 98, closePrice: 100,
                    volume: 5, buyVolume: null, tradeCount: null,
                }],
            },
        },
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
