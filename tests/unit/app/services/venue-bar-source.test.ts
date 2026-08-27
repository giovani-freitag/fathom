import { describe, expect, it, vi } from 'vitest';
import type { HeatmapSource } from '../../../../src/shared/core/heatmap-source.ts';
import { EMPTY_BAR_WINDOW, type PriceBarQuery } from '../../../../src/shared/core/price-bar.ts';
import { VenueBarSource } from '../../../../src/app/services/venue-bar-source.ts';
import type { VenueCandleService } from '../../../../src/app/services/venue-candle-service.ts';

const MINUTE_MS = 60_000;

const QUERY: PriceBarQuery = {
    symbol: 'BTCUSDT',
    fromMs: 0,
    toMs: MINUTE_MS * 10,
    intervalMs: MINUTE_MS,
    warmupBars: 0,
};

interface Asked {
    readonly archive: string[];
    readonly venue: string[];
}

function buildSource(asked: Asked, venueFails = false): VenueBarSource {
    const archive = {
        fetchInstruments: vi.fn(() => { asked.archive.push('instruments'); return Promise.resolve([]); }),
        fetchFrameWindow: vi.fn(() => { asked.archive.push('frames'); return Promise.resolve({}); }),
        fetchTradeClusters: vi.fn(() => { asked.archive.push('clusters'); return Promise.resolve({}); }),
        fetchGaps: vi.fn(() => { asked.archive.push('gaps'); return Promise.resolve([]); }),
        fetchPriceBars: vi.fn(() => {
            asked.archive.push('bars');
            return Promise.resolve({ ...EMPTY_BAR_WINDOW, instrumentSymbol: 'archive' });
        }),
    } as unknown as HeatmapSource;

    const candles = {
        fetchPriceBars: vi.fn(() => {
            asked.venue.push('bars');
            return venueFails
                ? Promise.reject(new Error('venue is down'))
                : Promise.resolve({ ...EMPTY_BAR_WINDOW, instrumentSymbol: 'venue' });
        }),
    } as unknown as VenueCandleService;

    return new VenueBarSource({ archive, candles });
}

describe('VenueBarSource', () => {
    it('takes the candles from the venue, which has every past day', async () => {
        const asked: Asked = { archive: [], venue: [] };

        const window = await buildSource(asked).fetchPriceBars(QUERY);

        expect([window.instrumentSymbol, asked.archive]).toEqual(['venue', []]);
    });

    it('takes them from the archive below a minute, which no venue publishes', async () => {
        const asked: Asked = { archive: [], venue: [] };

        const window = await buildSource(asked).fetchPriceBars({ ...QUERY, intervalMs: 1_000 });

        expect([window.instrumentSymbol, asked.venue]).toEqual(['archive', []]);
    });

    it('falls back to what was recorded when the venue cannot be reached', async () => {
        // A venue that is unreachable is not a chart that cannot be drawn: what
        // was recorded is still there, and drawing that beats drawing nothing.
        const asked: Asked = { archive: [], venue: [] };

        const window = await buildSource(asked, true).fetchPriceBars(QUERY);

        expect(window.instrumentSymbol).toBe('archive');
    });

    it('gives up when the window that asked has moved on', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(buildSource({ archive: [], venue: [] }, true)
            .fetchPriceBars(QUERY, controller.signal)).rejects.toThrow();
    });

    it('leaves the book to the archive, which is the only thing that has it', async () => {
        const asked: Asked = { archive: [], venue: [] };
        const source = buildSource(asked);

        await source.fetchFrameWindow({ symbol: 'BTCUSDT', fromMs: 0, toMs: 1, maxColumns: 1 });
        await source.fetchGaps({ symbol: 'BTCUSDT', fromMs: 0, toMs: 1, maxColumns: 1 });
        await source.fetchTradeClusters({ symbol: 'BTCUSDT', fromMs: 0, toMs: 1, maxColumns: 1 });
        await source.fetchInstruments();

        expect(asked.archive).toEqual(['frames', 'gaps', 'clusters', 'instruments']);
    });
});
