import { MAXIMUM_WINDOW_MS } from '../../../src/shared/core/api-contract.ts';
import { WindowLoader, type WindowSource } from '../../../src/app/core/window-loader.ts';
import { describe, expect, it, vi } from 'vitest';
import { buildWindow, buildFrame, createChartServiceMocks } from '../../mocks/chart-services.ts';

const VIEWPORT = { fromMs: 1_000_000, toMs: 1_900_000, lowPrice: 78_000, highPrice: 79_000 };

interface Harness {
    readonly loader: WindowLoader;
    readonly mocks: ReturnType<typeof createChartServiceMocks>;
    readonly loaded: unknown[];
    readonly failures: unknown[];
    readonly loadingStates: boolean[];
}

function buildHarness(): Harness {
    const mocks = createChartServiceMocks();
    const loaded: unknown[] = [];
    const failures: unknown[] = [];
    const loadingStates: boolean[] = [];

    const loader = new WindowLoader({
        api: mocks.api,
        onLoaded: (window) => loaded.push(window),
        onFailed: (error) => failures.push(error),
        onLoadingChanged: (isLoading) => loadingStates.push(isLoading),
    });

    return { loader, mocks, loaded, failures, loadingStates };
}

function buildRequest(overrides: Partial<Parameters<WindowLoader['load']>[0]> = {}) {
    return {
        symbol: 'BTCUSDT',
        viewport: VIEWPORT,
        surfaceWidthPx: 1_000,
        frameIntervalMs: 1_000,
        priceGroupSize: 1,
        warmupBars: 1,
        barIntervalMs: null,
        sources: ['frames', 'trades'] as readonly WindowSource[],
        ...overrides,
    };
}

describe('WindowLoader.load', () => {
    it('fetches frames, executions, and gaps together', async () => {
        const harness = buildHarness();

        await harness.loader.load(buildRequest());

        expect([
            harness.mocks.fetchFrameWindow.mock.calls.length,
            harness.mocks.fetchTradeClusters.mock.calls.length,
            harness.mocks.fetchGaps.mock.calls.length,
        ]).toEqual([1, 1, 1]);
    });

    it('asks for more than the visible span so a short pan needs no refetch', async () => {
        const harness = buildHarness();

        await harness.loader.load(buildRequest());

        const query = harness.mocks.fetchFrameWindow.mock.calls[0]?.[0] as { fromMs: number; toMs: number };
        expect(query.toMs - query.fromMs).toBeGreaterThan(VIEWPORT.toMs - VIEWPORT.fromMs);
    });

    it('publishes the window it loaded', async () => {
        const harness = buildHarness();

        await harness.loader.load(buildRequest());

        expect(harness.loaded.length).toBe(1);
    });

    it('skips a second request for the identical window', async () => {
        const harness = buildHarness();
        await harness.loader.load(buildRequest());

        await harness.loader.load(buildRequest());

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(1);
    });

    it('fetches again once the view has actually moved', async () => {
        const harness = buildHarness();
        await harness.loader.load(buildRequest());

        await harness.loader.load(buildRequest({
            viewport: { ...VIEWPORT, fromMs: 1_100_000, toMs: 2_000_000 },
        }));

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(2);
    });

    it('lets a failed window be retried', async () => {
        const harness = buildHarness();
        harness.mocks.fetchFrameWindow.mockRejectedValueOnce(new Error('gateway unreachable'));
        await harness.loader.load(buildRequest());

        await harness.loader.load(buildRequest());

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(2);
    });

    it('reports a failure rather than rejecting', async () => {
        const harness = buildHarness();
        harness.mocks.fetchFrameWindow.mockRejectedValue(new Error('gateway unreachable'));

        await expect(harness.loader.load(buildRequest())).resolves.toBeUndefined();
        expect(harness.failures.length).toBe(1);
    });

    it('announces loading and then done', async () => {
        const harness = buildHarness();

        await harness.loader.load(buildRequest());

        expect(harness.loadingStates[0]).toBe(true);
    });

    it('publishes nothing once disposed', async () => {
        const harness = buildHarness();
        harness.loader.dispose();

        await harness.loader.load(buildRequest());

        expect(harness.loaded).toEqual([]);
    });
});

describe('WindowLoader.scheduleIfStale', () => {
    it('does nothing while the view fits what is loaded', async () => {
        vi.useFakeTimers();
        const harness = buildHarness();
        await harness.loader.load(buildRequest());

        harness.loader.scheduleIfStale(buildRequest());
        await vi.advanceTimersByTimeAsync(500);

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(1);
        vi.useRealTimers();
    });

    it('fetches once the view has moved past what is loaded', async () => {
        vi.useFakeTimers();
        const harness = buildHarness();
        await harness.loader.load(buildRequest());

        harness.loader.scheduleIfStale(buildRequest({
            viewport: { ...VIEWPORT, fromMs: 5_000_000, toMs: 5_900_000 },
        }));
        await vi.advanceTimersByTimeAsync(500);

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(2);
        vi.useRealTimers();
    });

    it('collapses a burst of gesture updates into one fetch', async () => {
        vi.useFakeTimers();
        const harness = buildHarness();
        await harness.loader.load(buildRequest());

        for (let step = 1; step <= 8; step += 1) {
            harness.loader.scheduleIfStale(buildRequest({
                viewport: { ...VIEWPORT, fromMs: 5_000_000 + step, toMs: 5_900_000 + step },
            }));
        }
        await vi.advanceTimersByTimeAsync(500);

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(2);
        vi.useRealTimers();
    });

    it('fetches again after a reset even for the same window', async () => {
        vi.useFakeTimers();
        const harness = buildHarness();
        await harness.loader.load(buildRequest());

        harness.loader.reset();
        harness.loader.scheduleIfStale(buildRequest());
        await vi.advanceTimersByTimeAsync(500);

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(2);
        vi.useRealTimers();
    });

    it('drops a pending fetch when disposed', async () => {
        vi.useFakeTimers();
        const harness = buildHarness();
        harness.loader.scheduleIfStale(buildRequest());

        harness.loader.dispose();
        await vi.advanceTimersByTimeAsync(500);

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(0);
        vi.useRealTimers();
    });
});

describe('WindowLoader resolution', () => {
    it('refetches when the view needs finer columns than are loaded', async () => {
        vi.useFakeTimers();
        const harness = buildHarness();
        harness.mocks.fetchFrameWindow.mockResolvedValue({
            ...buildWindow([buildFrame(1_500_000)]),
            sampleIntervalMs: 60_000,
        });
        await harness.loader.load(buildRequest());

        harness.loader.scheduleIfStale(buildRequest({
            viewport: { ...VIEWPORT, fromMs: 1_400_000, toMs: 1_405_000 },
        }));
        await vi.advanceTimersByTimeAsync(500);

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(2);
        vi.useRealTimers();
    });
});

describe('WindowLoader sources', () => {
    it('fetches none of the book when nothing on the chart draws it', async () => {
        // The frame window is by far the heaviest thing the gateway serves, and
        // a chart showing candles alone was paying for it to draw nothing.
        const { loader, mocks } = buildHarness();

        await loader.load(buildRequest({ sources: [] }));

        expect(mocks.api.fetchFrameWindow).not.toHaveBeenCalled();
        expect(mocks.api.fetchTradeClusters).not.toHaveBeenCalled();
        expect(mocks.api.fetchPriceBars).toHaveBeenCalled();
    });

    it('fetches the executions without the frames when only they are read', async () => {
        const { loader, mocks } = buildHarness();

        await loader.load(buildRequest({ sources: ['trades'] }));

        expect(mocks.api.fetchFrameWindow).not.toHaveBeenCalled();
        expect(mocks.api.fetchTradeClusters).toHaveBeenCalled();
    });

    it('answers with an empty window rather than nothing when a source was skipped', async () => {
        const { loader, loaded } = buildHarness();

        await loader.load(buildRequest({ sources: [] }));

        const window = loaded[0] as { window: { frames: unknown[] }; clusters: unknown[] };
        expect(window.window.frames).toEqual([]);
        expect(window.clusters).toEqual([]);
    });

    it('fetches again when the book is turned on over the same range', async () => {
        // The range has not moved, so the request would otherwise be recognised
        // as one already answered and the book would stay blank.
        const { loader, mocks } = buildHarness();
        await loader.load(buildRequest({ sources: [] }));

        await loader.load(buildRequest({ sources: ['frames'] }));

        expect(mocks.api.fetchFrameWindow).toHaveBeenCalledTimes(1);
    });
});

describe('WindowLoader against what the archive will answer', () => {
    it('never asks for a window wider than the gateway answers', async () => {
        // The widest view plus the overscan around it used to come to more than
        // twice the ceiling. Nobody saw it because nobody had recorded enough
        // history to zoom out that far; the chart would have gone blank for the
        // first reader who had.
        const harness = buildHarness();
        const widest = MAXIMUM_WINDOW_MS;
        const toMs = 2_000_000_000_000;

        await harness.loader.load(buildRequest({
            viewport: { ...VIEWPORT, fromMs: toMs - widest, toMs },
        }));

        const asked = harness.mocks.fetchPriceBars.mock.calls.at(-1)?.[0] as { fromMs: number; toMs: number };
        expect(asked.toMs - asked.fromMs).toBeLessThanOrEqual(MAXIMUM_WINDOW_MS);
    });

    it('still overscans a window with room to spare around it', async () => {
        // The ceiling only bites at the far end; a fifteen-minute view must
        // still fetch a pan's worth either side of what it shows.
        const harness = buildHarness();

        await harness.loader.load(buildRequest({}));

        const asked = harness.mocks.fetchPriceBars.mock.calls.at(-1)?.[0] as { fromMs: number; toMs: number };
        expect(asked.toMs - asked.fromMs).toBeGreaterThan(VIEWPORT.toMs - VIEWPORT.fromMs);
    });
});
