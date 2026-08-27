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

    it('never asks the archive for one, whatever the rung', async () => {
        // One source for a candle. A bar that came from the venue on a good day
        // and from the recording on a bad one would be a bar whose meaning
        // depended on the network.
        const asked: Asked = { archive: [], venue: [] };

        await buildSource(asked).fetchPriceBars({ ...QUERY, intervalMs: 86_400_000 });

        expect(asked.archive).toEqual([]);
    });

    it('says so when the venue cannot be reached, rather than drawing something else', async () => {
        const asked: Asked = { archive: [], venue: [] };

        await expect(buildSource(asked, true).fetchPriceBars(QUERY)).rejects.toThrow('venue is down');
        expect(asked.archive).toEqual([]);
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
