import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeatmapApiError, HeatmapApiService } from '../../../../src/app/services/heatmap-api-service.ts';

describe('HeatmapApiService', () => {
    let service: HeatmapApiService;
    let calledUrl: URL;

    function answerWith(response: Partial<Response>): void {
        vi.stubGlobal('fetch', vi.fn((url: URL) => {
            calledUrl = url;
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), ...response });
        }));
    }

    beforeEach(() => {
        // A trailing slash on the origin would otherwise double up against the
        // route's leading one and every request would 404 on a real gateway.
        service = new HeatmapApiService({ baseUrl: 'http://gateway.invalid/' });
        answerWith({});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('asks the gateway on one slash, whatever the origin ended with', async () => {
        await service.fetchInstruments();

        expect(calledUrl.pathname).not.toContain('//');
    });

    it('carries the window it is asking about in the query', async () => {
        answerWith({ json: () => Promise.resolve({ clusters: [], priceBucketSize: 10, sampleIntervalMs: 1_000 }) });

        await service.fetchTradeClusters({
            symbol: 'BTCUSDT', fromMs: 1_000, toMs: 2_000, maxColumns: 60,
            priceGroupSize: 1, minimumQuantity: 0,
        });

        expect(calledUrl.searchParams.get('symbol')).toBe('BTCUSDT');
        expect(calledUrl.searchParams.get('fromMs')).toBe('1000');
    });

    it('reports nothing answering at all as a status of zero', async () => {
        // The chart tells a reader to check the gateway is running only when
        // nothing answered; a refusal is a different sentence.
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))));

        await expect(service.fetchInstruments()).rejects.toMatchObject({ status: 0 });
    });

    it('carries the status through when the gateway refuses', async () => {
        answerWith({ ok: false, status: 503 });

        await expect(service.fetchInstruments()).rejects.toBeInstanceOf(HeatmapApiError);
        await expect(service.fetchInstruments()).rejects.toMatchObject({ status: 503 });
    });

    it('lets an abort through rather than dressing it as a gateway fault', async () => {
        // A window the reader panned away from aborts its own request, and the
        // chart must not paint that as the gateway having gone down.
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))));

        await expect(service.fetchInstruments()).rejects.not.toBeInstanceOf(HeatmapApiError);
    });
});
