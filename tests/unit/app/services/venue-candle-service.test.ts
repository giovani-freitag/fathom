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
    return new VenueCandleService({
        restApiBaseUrl: 'https://venue.example',
        readNowMs: () => NOW_MS,
        fetch: vi.fn((input: URL | RequestInfo) => {
            answered.urls.push(input instanceof URL ? input.href : '');
            const body = pages[Math.min(page, pages.length - 1)] ?? [];
            page += 1;
            return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
        }),
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
        const service = new VenueCandleService({
            restApiBaseUrl: 'https://venue.example',
            readNowMs: () => NOW_MS,
            fetch: () => Promise.resolve({ ok: false, status: 418 } as Response),
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
