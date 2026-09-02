import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServerHarness, type ServerHarness } from '../../mocks/server-harness.ts';

const FROM_MS = 1_700_000_000_000;
const TO_MS = FROM_MS + 900_000;

let harness: ServerHarness;

beforeEach(async () => {
    harness = createServerHarness();
    await harness.server.getApp().ready();
});

afterEach(async () => {
    await harness.server.getApp().close();
});

function get(url: string) {
    return harness.server.getApp().inject({ method: 'GET', url });
}

/** Typed at the call site, because `inject` answers with an untyped body. */
function bodyOf<TBody>(response: { json: () => unknown }): TBody {
    return response.json() as TBody;
}

describe('GET /api/health', () => {
    it('answers with the clock and whether the archive can be reached', async () => {
        const response = await get('/api/health');

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ isDatabaseReachable: true });
    });
});

describe('GET /api/instruments', () => {
    it('answers with every recorded contract and its extent', async () => {
        harness.query.listInstruments.mockResolvedValue([{
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            frameIntervalMs: 1_000,
            firstFrameAtMs: FROM_MS,
            lastFrameAtMs: TO_MS,
            lastMidPrice: 79_000,
        }]);

        const response = await get('/api/instruments');

        expect(bodyOf<{ instruments: unknown[] }>(response).instruments[0]).toMatchObject({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
        });
    });
});

describe('GET /api/gaps', () => {
    it('answers with the stretches nothing was recorded in', async () => {
        harness.query.fetchGaps.mockResolvedValue([
            { gapStartedAtMs: FROM_MS, gapEndedAtMs: FROM_MS + 5_000, gapReason: 'restart' },
        ]);

        const response = await get(`/api/gaps?symbol=BTCUSDT&fromMs=${FROM_MS}&toMs=${TO_MS}&maxColumns=800`);

        expect(bodyOf<{ gaps: unknown[] }>(response).gaps).toEqual([
            { gapStartedAtMs: FROM_MS, gapEndedAtMs: FROM_MS + 5_000, gapReason: 'restart' },
        ]);
    });
});

describe('GET /api/heatmap', () => {
    it('answers in bytes rather than JSON, and forbids caching them', async () => {
        const response = await get(`/api/heatmap?symbol=BTCUSDT&fromMs=${FROM_MS}&toMs=${TO_MS}&maxColumns=800`);

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('application/octet-stream');
        expect(response.headers['cache-control']).toBe('no-store');
    });

    it('refuses a range that ends before it starts', async () => {
        const response = await get(`/api/heatmap?symbol=BTCUSDT&fromMs=${TO_MS}&toMs=${FROM_MS}&maxColumns=800`);

        expect(response.statusCode).toBe(400);
        expect(bodyOf<{ error: string }>(response).error).toBe('InvalidRange');
    });

    it('refuses a price no venue could quote, rather than failing inside the read', async () => {
        // A client with no band of its own reaches for the largest number it
        // can spell. Laying out every row beneath that fails in the archive,
        // and the reader is told the recording is unreachable when it is fine.
        const response = await get(`/api/heatmap?symbol=BTCUSDT&fromMs=${FROM_MS}&toMs=${TO_MS}`
            + `&maxColumns=800&maxRows=568&lowPrice=0&highPrice=${Number.MAX_SAFE_INTEGER}`);

        expect(response.statusCode).toBe(400);
    });

    it('refuses a range too wide to answer', async () => {
        const wideToMs = FROM_MS + 400 * 24 * 60 * 60 * 1_000;

        const response = await get(`/api/heatmap?symbol=BTCUSDT&fromMs=${FROM_MS}&toMs=${wideToMs}&maxColumns=800`);

        expect(response.statusCode).toBe(400);
        expect(bodyOf<{ error: string }>(response).error).toBe('RangeTooWide');
    });

});

describe('GET /api/trade-clusters', () => {
    it('answers with the executions and the grid they were grouped on', async () => {
        harness.query.fetchTradeClusters.mockResolvedValue({
            priceBucketSize: 10,
            sampleIntervalMs: 5_000,
            clusters: [{
                executedAtMs: FROM_MS,
                priceBucketIndex: 7_850,
                buyQuantity: 1.5,
                sellQuantity: 0.5,
                tradeCount: 3,
                largestTradeQuantity: 1,
            }],
        });

        const response = await get(`/api/trade-clusters?symbol=BTCUSDT&fromMs=${FROM_MS}&toMs=${TO_MS}&maxColumns=800`);

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ priceBucketSize: 10, sampleIntervalMs: 5_000 });
        expect(bodyOf<{ clusters: unknown[] }>(response).clusters[0]).toMatchObject({ buyQuantity: 1.5, largestTradeQuantity: 1 });
    });

    it('refuses a range that ends before it starts', async () => {
        const response = await get(`/api/trade-clusters?symbol=BTCUSDT&fromMs=${TO_MS}&toMs=${FROM_MS}&maxColumns=800`);

        expect(response.statusCode).toBe(400);
    });
});

describe('GET /api/recording', () => {
    it('answers with what is being recorded and how much room is left', async () => {
        harness.control.listContracts.mockResolvedValue([{
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            frameIntervalMs: 1_000,
            isEnabled: true,
        }]);

        const response = await get('/api/recording');

        expect(response.json()).toMatchObject({
            instruments: [{ instrumentSymbol: 'BTCUSDT', isEnabled: true }],
            maximumBytes: 10_737_418_240,
        });
    });
});

describe('every window is refused on the same terms', () => {
    // A caller who inverts a range used to get a refusal from one route and an
    // empty answer from another, with no way to tell a question asked wrong
    // from a stretch nothing was recorded in.
    const WINDOWED = [
        '/api/heatmap?symbol=BTCUSDT&maxColumns=800',
        '/api/trade-clusters?symbol=BTCUSDT&maxColumns=800',
        '/api/gaps?symbol=BTCUSDT&maxColumns=800',
    ];

    const YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

    it.each(WINDOWED)('refuses a range that ends before it starts: %s', async (route) => {
        const response = await get(`${route}&fromMs=${TO_MS}&toMs=${FROM_MS}`);

        expect(response.statusCode).toBe(400);
        expect(bodyOf<{ error: string }>(response).error).toBe('InvalidRange');
    });

    it.each(WINDOWED)('refuses a range too wide to answer: %s', async (route) => {
        const response = await get(`${route}&fromMs=${FROM_MS}&toMs=${FROM_MS + YEAR_MS}`);

        expect(response.statusCode).toBe(400);
        expect(bodyOf<{ error: string }>(response).error).toBe('RangeTooWide');
    });

    it.each(WINDOWED)('asks the archive nothing once it has refused: %s', async (route) => {
        await get(`${route}&fromMs=${TO_MS}&toMs=${FROM_MS}`);

        const asked = Object.values(harness.query).some((spy) => spy.mock.calls.length > 0);
        expect(asked).toBe(false);
    });
});

describe('PUT /api/recording', () => {
    function put(url: string, payload: Readonly<Record<string, unknown>>) {
        return harness.server.getApp().inject({ method: 'PUT', url, payload });
    }

    it('saves the contract and answers with what is being recorded now', async () => {
        const response = await put('/api/recording', {
            instrumentSymbol: 'ETHUSDT',
            priceBucketSize: 0.5,
            frameIntervalMs: 1_000,
            isEnabled: true,
        });

        expect(response.statusCode).toBe(200);
        expect(harness.control.saveContract).toHaveBeenCalledWith(
            expect.objectContaining({ instrumentSymbol: 'ETHUSDT', isEnabled: true }),
        );
    });

    it('refuses a contract with no symbol', async () => {
        // Everything here reaches the archive: a body that got past the schema
        // would be written.
        const response = await put('/api/recording', {
            instrumentSymbol: '',
            priceBucketSize: 0.5,
            frameIntervalMs: 1_000,
            isEnabled: true,
        });

        expect(response.statusCode).toBe(400);
        expect(harness.control.saveContract).not.toHaveBeenCalled();
    });

    it('refuses a grid finer than the collector can write', async () => {
        const response = await put('/api/recording', {
            instrumentSymbol: 'ETHUSDT',
            priceBucketSize: 0,
            frameIntervalMs: 10,
            isEnabled: true,
        });

        expect(response.statusCode).toBe(400);
        expect(harness.control.saveContract).not.toHaveBeenCalled();
    });
});

describe('PUT /api/recording/budget', () => {
    function put(payload: Readonly<Record<string, unknown>>) {
        return harness.server.getApp().inject({ method: 'PUT', url: '/api/recording/budget', payload });
    }

    it('sets the ceiling and answers with the state it leaves behind', async () => {
        const response = await put({ maximumBytes: 21_474_836_480 });

        expect(response.statusCode).toBe(200);
        expect(harness.control.setBudget).toHaveBeenCalledWith(21_474_836_480);
    });

    it('refuses a ceiling under a gigabyte, which would prune everything', async () => {
        const response = await put({ maximumBytes: 1_000 });

        expect(response.statusCode).toBe(400);
        expect(harness.control.setBudget).not.toHaveBeenCalled();
    });
});

describe('GET /api/health when the archive cannot be reached', () => {
    it('still answers, and says so', async () => {
        // A gateway that fell over when the archive did would leave a reader
        // with a blank page instead of a reason.
        harness.postgres.selectRows.mockRejectedValue(new Error('connection refused'));

        const response = await get('/api/health');

        expect(response.statusCode).toBe(200);
        expect(bodyOf<{ isDatabaseReachable: boolean }>(response).isDatabaseReachable).toBe(false);
    });
});


describe('GET /api/heatmap reading the whole book', () => {
    it('reads the archive, which is the only store there is', async () => {
        await get(`/api/heatmap?symbol=BTCUSDT&fromMs=${FROM_MS}&toMs=${TO_MS}&maxColumns=600`);

        expect(harness.chunks.fetchWindow).toHaveBeenCalledTimes(1);
    });

    it('narrows the read to the prices the caller named', async () => {
        // The archive is addressed by price as well as by time, so a band
        // decides which squares are read at all. Applying it after the read
        // instead would fetch the whole book to draw a hundredth of it.
        await get(`/api/heatmap?symbol=BTCUSDT&fromMs=${FROM_MS}&toMs=${TO_MS}`
            + '&maxColumns=600&lowPrice=60000&highPrice=61000&maxRows=400');

        expect(harness.chunks.fetchWindow).toHaveBeenCalledWith(expect.objectContaining({
            instrumentSymbol: 'BTCUSDT',
            fromMs: FROM_MS,
            toMs: TO_MS,
            lowPrice: 60_000,
            highPrice: 61_000,
            maxRows: 400,
        }));
    });
});
