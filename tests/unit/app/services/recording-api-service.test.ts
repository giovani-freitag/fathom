import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeatmapSourceError } from '../../../../src/shared/core/heatmap-source.ts';
import { RecordingApiService } from '../../../../src/app/services/recording-api-service.ts';

const STATE = {
    instruments: [{ instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frameIntervalMs: 1_000, isEnabled: true }],
    maximumBytes: 100,
    usedBytes: 40,
};

describe('RecordingApiService', () => {
    let service: RecordingApiService;
    let fetchSpy: ReturnType<typeof vi.fn>;

    /** Answers every request with one prepared response. */
    function answerWith(response: Partial<Response>): void {
        fetchSpy = vi.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(STATE),
            ...response,
        }));
        vi.stubGlobal('fetch', fetchSpy);
    }

    /** How the last request was made. */
    function readLastRequest(): { url: URL; init: RequestInit } {
        const [url, init] = fetchSpy.mock.calls.at(-1) as [URL, RequestInit];
        return { url, init };
    }

    beforeEach(() => {
        service = new RecordingApiService({ baseUrl: 'http://gateway.invalid/' });
        answerWith({});
    });

    afterEach(() => { vi.unstubAllGlobals(); });

    it('reads every contract the gateway knows', async () => {
        await expect(service.listContracts()).resolves.toEqual(STATE.instruments);
    });

    it('reads the budget out of the same state the contracts came in', async () => {
        await expect(service.readBudget()).resolves.toEqual({
            maximumBytes: 100,
            usedBytes: 40,
            availableBytes: null,
        });
    });

    it('sends a changed contract as the whole contract', async () => {
        const contract = { instrumentSymbol: 'ETHUSDT', priceBucketSize: 5, frameIntervalMs: 500, isEnabled: false };

        await service.saveContract(contract);

        expect(readLastRequest().init.body).toBe(JSON.stringify(contract));
    });

    it('changes a contract with a method that replaces it', async () => {
        await service.saveContract(STATE.instruments[0]!);

        expect(readLastRequest().init.method).toBe('PUT');
    });

    it('sends a new ceiling on its own route', async () => {
        await service.setBudget(2_048);

        expect(readLastRequest().url.pathname).toContain('budget');
    });

    it('prunes nothing, because the collector prunes on its own schedule', async () => {
        await expect(service.pruneToBudget()).resolves.toBe(0);
    });

    it('reports a gateway that did not answer at all', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

        await expect(service.listContracts()).rejects.toThrow(HeatmapSourceError);
    });

    it('reports a refusal with the status the gateway gave', async () => {
        answerWith({ ok: false, status: 403 });

        await expect(service.saveContract(STATE.instruments[0]!)).rejects.toMatchObject({ status: 403 });
    });

    it('reports a body it cannot read rather than letting a parse error escape', async () => {
        // A tunnel or proxy in front of the gateway answers 200 with its own
        // HTML, and a control that silently throws leaves the switch showing a
        // state nobody applied.
        answerWith({ json: () => Promise.reject(new SyntaxError('Unexpected token <')) });

        await expect(service.listContracts()).rejects.toThrow(HeatmapSourceError);
    });
});
