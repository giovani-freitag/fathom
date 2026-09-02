import { MAXIMUM_WINDOW_MS } from '../../../src/shared/core/api-contract.ts';
import { EMPTY_BAR_WINDOW } from '../../../src/shared/core/price-bar.ts';
import {
    type LoadedWindow,
    WindowLoader,
    type WindowSource,
} from '../../../src/app/core/window-loader.ts';
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
        higherBars: [],
        sources: ['frames', 'trades'] as readonly WindowSource[],
        priceBand: null,
        ...overrides,
    };
}

describe('WindowLoader and the price band it loaded', () => {
    it('does not call a whole-book window stale for the prices on screen', async () => {
        // Before the chart has framed itself it asks for the whole book. Held
        // to a band of nothing, every later gesture would schedule a reload
        // that the request key then throws away.
        const harness = buildHarness();
        await harness.loader.load(buildRequest());

        harness.loader.scheduleIfStale(buildRequest());
        await new Promise((resolve) => { setTimeout(resolve, 300); });

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(1);
    });
});

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

    it('asks only for the stretch a pan adds, keeping what it already holds', async () => {
        // The window loaded reaches well past the view on both sides, so a pan
        // of most of a screen still leaves half of the new window inside the old
        // one. Fetched whole every time, that half is read from the archive,
        // sent, and decoded again to arrive at instants already held.
        const harness = buildHarness();
        await harness.loader.load(buildRequest());
        const spanMs = VIEWPORT.toMs - VIEWPORT.fromMs;

        await harness.loader.load(buildRequest({
            viewport: { ...VIEWPORT, fromMs: VIEWPORT.fromMs - spanMs / 2, toMs: VIEWPORT.toMs - spanMs / 2 },
        }));

        const second = harness.mocks.fetchFrameWindow.mock.calls[1]?.[0];
        expect((second?.toMs ?? 0) - (second?.fromMs ?? 0)).toBeLessThan(spanMs);
    });

    it('hands back the whole window even though it only asked for part of it', async () => {
        const harness = buildHarness();
        // One instant at each end of whatever stretch was asked for, so a
        // window stitched from two pieces holds more than either of them.
        harness.mocks.fetchFrameWindow.mockImplementation((query) => Promise.resolve(buildWindow([
            buildFrame(query.fromMs),
            buildFrame(Math.round((query.fromMs + query.toMs) / 2)),
        ])));
        await harness.loader.load(buildRequest());
        const held = (harness.loaded.at(-1) as LoadedWindow | undefined)?.window.frames.length ?? 0;
        const spanMs = VIEWPORT.toMs - VIEWPORT.fromMs;

        await harness.loader.load(buildRequest({
            viewport: { ...VIEWPORT, fromMs: VIEWPORT.fromMs - spanMs / 2, toMs: VIEWPORT.toMs - spanMs / 2 },
        }));

        expect((harness.loaded.at(-1) as LoadedWindow | undefined)?.window.frames.length ?? 0)
            .toBeGreaterThan(held);
    });

    it('throws the pieces away when they came back on another grid', async () => {
        // A grid is what makes two pieces the same picture, and nothing else
        // about the request guarantees it: the archive answers off whichever
        // level reaches back far enough, and a pan into older history can find
        // a different one.
        const harness = buildHarness();
        await harness.loader.load(buildRequest());
        harness.mocks.fetchFrameWindow.mockResolvedValue({
            ...buildWindow([buildFrame(1_400_000)]), priceBucketSize: 640,
        });
        const spanMs = VIEWPORT.toMs - VIEWPORT.fromMs;

        await harness.loader.load(buildRequest({
            viewport: { ...VIEWPORT, fromMs: VIEWPORT.fromMs - spanMs / 2, toMs: VIEWPORT.toMs - spanMs / 2 },
        }));

        expect((harness.loaded.at(-1) as LoadedWindow | undefined)?.window.priceBucketSize).toBe(640);
    });

    it('asks for the time and the prices separately when a drag went diagonally', async () => {
        // The case the old stitching gave up on: any move in price threw the
        // whole window away, and the saving on the time axis went with it. What
        // came into view is an L — a stretch of instants over the whole band,
        // and a stretch of prices over the instants that did not move.
        const harness = buildHarness();
        const step = (fraction: number) => ({
            ...VIEWPORT,
            fromMs: VIEWPORT.fromMs - (VIEWPORT.toMs - VIEWPORT.fromMs) * fraction,
            toMs: VIEWPORT.toMs - (VIEWPORT.toMs - VIEWPORT.fromMs) * fraction,
            lowPrice: VIEWPORT.lowPrice + 200 * fraction,
            highPrice: VIEWPORT.highPrice + 200 * fraction,
        });
        await harness.loader.load(buildRequest({ priceBand: VIEWPORT }));
        const first = harness.mocks.fetchFrameWindow.mock.calls[0]?.[0];
        const whole = (first?.toMs ?? 0) - (first?.fromMs ?? 0);
        const before = harness.mocks.fetchFrameWindow.mock.calls.length;

        await harness.loader.load(buildRequest({ viewport: step(0.9), priceBand: step(0.9) }));

        const asked = harness.mocks.fetchFrameWindow.mock.calls.slice(before).map((call) => call[0]);
        expect([asked.length, asked.every((one) => one.toMs - one.fromMs < whole)])
            .toEqual([2, true]);
    });

    it('asks for nothing at all when the reader comes back to where it was', async () => {
        // Walking back over a stretch and forward again is the gesture a chart
        // is used with more than any other, and it cost the whole window twice.
        const harness = buildHarness();
        const moved = {
            ...VIEWPORT,
            fromMs: VIEWPORT.fromMs - 400_000,
            toMs: VIEWPORT.toMs - 400_000,
        };
        await harness.loader.load(buildRequest({ priceBand: VIEWPORT }));
        await harness.loader.load(buildRequest({ viewport: moved, priceBand: VIEWPORT }));
        const before = harness.mocks.fetchFrameWindow.mock.calls.length;

        await harness.loader.load(buildRequest({ priceBand: VIEWPORT }));

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(before);
    });

    it('asks for the whole window when the reader jumped somewhere else', async () => {
        const harness = buildHarness();
        await harness.loader.load(buildRequest());
        const spanMs = VIEWPORT.toMs - VIEWPORT.fromMs;

        await harness.loader.load(buildRequest({
            viewport: { ...VIEWPORT, fromMs: VIEWPORT.fromMs - spanMs * 40, toMs: VIEWPORT.toMs - spanMs * 40 },
        }));

        const second = harness.mocks.fetchFrameWindow.mock.calls[1]?.[0];
        expect((second?.toMs ?? 0) - (second?.fromMs ?? 0)).toBeGreaterThan(spanMs);
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

    it('asks the moment the hand lifts rather than waiting out the settling time', async () => {
        // The settling time is for a hand still moving. Spent after it has
        // lifted, it is a fifth of a second of the old picture for no reason —
        // measured against a read that answers in less than that.
        vi.useFakeTimers();
        const harness = buildHarness();
        await harness.loader.load(buildRequest());
        const before = harness.mocks.fetchFrameWindow.mock.calls.length;

        harness.loader.scheduleIfStale(buildRequest({
            viewport: { ...VIEWPORT, fromMs: 9_000_000, toMs: 9_600_000 },
        }), true);
        await vi.advanceTimersByTimeAsync(0);

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(before + 1);
        vi.useRealTimers();
    });

    it('still collects the views a hand writes while it is still moving', async () => {
        vi.useFakeTimers();
        const harness = buildHarness();
        await harness.loader.load(buildRequest());
        const before = harness.mocks.fetchFrameWindow.mock.calls.length;

        harness.loader.scheduleIfStale(buildRequest({
            viewport: { ...VIEWPORT, fromMs: 9_000_000, toMs: 9_600_000 },
        }));
        await vi.advanceTimersByTimeAsync(0);

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(before);
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

describe('WindowLoader reading the way ahead', () => {
    /** Two reads in the same direction, so the loader knows which way that is. */
    async function walk(harness: ReturnType<typeof buildHarness>, steps: number) {
        for (let step = 1; step <= steps; step += 1) {
            const shift = (VIEWPORT.toMs - VIEWPORT.fromMs) * 0.9 * step;
            await harness.loader.load(buildRequest({
                priceBand: VIEWPORT,
                viewport: { ...VIEWPORT, fromMs: VIEWPORT.fromMs - shift, toMs: VIEWPORT.toMs - shift },
            }));
        }
    }

    it('reads the stretch beyond the one it was asked for, once things go quiet', async () => {
        // A reader panning does it again a second later, and read while nothing
        // else is going on, that next pan costs nothing at all.
        vi.useFakeTimers();
        const harness = buildHarness();
        await walk(harness, 2);
        const asked = harness.mocks.fetchFrameWindow.mock.calls;
        const lastAsked = asked[asked.length - 1]?.[0];
        const before = asked.length;

        await vi.advanceTimersByTimeAsync(600);

        // Ahead of the reader, which is the way they were already going: read
        // behind them instead and it is a round trip spent on what they have
        // just left.
        const ahead = harness.mocks.fetchFrameWindow.mock.calls[before]?.[0];
        expect([asked.length > before, (ahead?.fromMs ?? 0) < (lastAsked?.fromMs ?? 0)])
            .toEqual([true, true]);
        vi.useRealTimers();
    });

    it('leaves the chart alone with what it read', async () => {
        // Nothing asked for it, so nothing may be handed a window because of it.
        vi.useFakeTimers();
        const harness = buildHarness();
        await walk(harness, 2);
        const published = harness.loaded.length;

        await vi.advanceTimersByTimeAsync(600);

        expect(harness.loaded.length).toBe(published);
        vi.useRealTimers();
    });

    it('reads nothing ahead of a reader who zoomed rather than panned', async () => {
        // A zoom lands on another level of the archive, so nothing read ahead of
        // it could be used; and the wager is about a gesture being repeated,
        // which a zoom in one direction rarely is.
        vi.useFakeTimers();
        const harness = buildHarness();
        await harness.loader.load(buildRequest({ priceBand: VIEWPORT }));
        const wider = { ...VIEWPORT, fromMs: VIEWPORT.fromMs - 3_000_000 };
        await harness.loader.load(buildRequest({ viewport: wider, priceBand: VIEWPORT }));
        const before = harness.mocks.fetchFrameWindow.mock.calls.length;

        await vi.advanceTimersByTimeAsync(600);

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(before);
        vi.useRealTimers();
    });

    it('reads nothing ahead of a reader that has not moved', async () => {
        vi.useFakeTimers();
        const harness = buildHarness();
        await harness.loader.load(buildRequest({ priceBand: VIEWPORT }));
        const before = harness.mocks.fetchFrameWindow.mock.calls.length;

        await vi.advanceTimersByTimeAsync(600);

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(before);
        vi.useRealTimers();
    });

    it('drops what it was reading ahead the moment a real read starts', async () => {
        vi.useFakeTimers();
        const harness = buildHarness();
        await walk(harness, 2);
        const before = harness.mocks.fetchFrameWindow.mock.calls.length;

        await harness.loader.load(buildRequest({
            priceBand: VIEWPORT,
            viewport: { ...VIEWPORT, fromMs: 5_000_000, toMs: 5_900_000 },
        }));
        await vi.advanceTimersByTimeAsync(200);

        // The real read, and nothing set off by the timer that was cancelled.
        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(before + 1);
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

describe('WindowLoader refusing a window it already holds', () => {
    it('fetches nothing twice for the same window asked for twice', async () => {
        const { loader, mocks } = buildHarness();

        await loader.load(buildRequest({}));
        await loader.load(buildRequest({}));

        expect(mocks.api.fetchFrameWindow).toHaveBeenCalledTimes(1);
    });


    it('fetches again for the same range with more history behind it', async () => {
        // A deeper indicator needs bars the loaded window does not hold, and
        // seeding from what is there draws a converged-looking line that is not.
        const { loader, mocks } = buildHarness();

        await loader.load(buildRequest({}));
        await loader.load(buildRequest({ warmupBars: 500 }));

        expect(mocks.api.fetchPriceBars).toHaveBeenCalledTimes(2);
    });
});

describe('WindowLoader and a band the reader has zoomed inside of', () => {
    /** The viewport, narrowed to a fraction of what it was when loaded. */
    function narrowed(fraction: number) {
        const centre = (VIEWPORT.lowPrice + VIEWPORT.highPrice) / 2;
        const half = ((VIEWPORT.highPrice - VIEWPORT.lowPrice) / 2) * fraction;
        return { ...VIEWPORT, lowPrice: centre - half, highPrice: centre + half };
    }

    it('asks again once the view is far inside the band it loaded', async () => {
        // A wide band is folded to fit the row budget, so the window comes back
        // on a coarser grid. Left alone, zooming in narrows the axis and never
        // sharpens the rows — the reader sees the coarse grid for ever.
        const harness = buildHarness();
        await harness.loader.load(buildRequest({ priceBand: VIEWPORT }));
        const before = harness.mocks.fetchFrameWindow.mock.calls.length;

        harness.loader.scheduleIfStale(buildRequest({
            viewport: narrowed(0.1), priceBand: narrowed(0.1),
        }));
        await new Promise((resolve) => { setTimeout(resolve, 300); });

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBeGreaterThan(before);
    });

    it('asks for the rows the pane has room to show, not a fixed budget', async () => {
        // Rows past what the pane can show are read, sent, and folded away
        // again by the reader. Worse, a reader that claims it wants every price
        // stops a whole-book store from ever answering off a coarser level: a
        // level folds prices as well as instants.
        const harness = buildHarness();

        await harness.loader.load(buildRequest({ priceBand: VIEWPORT, pricePaneHeightPx: 300 }));

        const asked = harness.mocks.fetchFrameWindow.mock.calls[0]?.[0] as
            { priceBand?: { maxRows: number } };
        expect(asked.priceBand?.maxRows).toBeLessThan(400);
    });

    it('still asks for every row it can when nobody said how tall the pane is', async () => {
        const harness = buildHarness();

        await harness.loader.load(buildRequest({ priceBand: VIEWPORT }));

        const asked = harness.mocks.fetchFrameWindow.mock.calls[0]?.[0] as
            { priceBand?: { maxRows: number } };
        expect(asked.priceBand?.maxRows).toBe(1_200);
    });

    it('asks for more rows than the pane holds, because the band reaches past it', async () => {
        // The band overscans the view on both sides so a short pan needs no
        // refetch. Rows for the pane alone would leave that overscan blank.
        const harness = buildHarness();

        await harness.loader.load(buildRequest({ priceBand: VIEWPORT, pricePaneHeightPx: 300 }));

        const asked = harness.mocks.fetchFrameWindow.mock.calls[0]?.[0] as
            { priceBand?: { maxRows: number } };
        expect(asked.priceBand?.maxRows).toBeGreaterThan(300 / 3);
    });

    it('leaves a band the view still nearly fills alone', async () => {
        // Asked again on every step, a pinch would be a request a frame.
        const harness = buildHarness();
        await harness.loader.load(buildRequest({ priceBand: VIEWPORT }));
        const before = harness.mocks.fetchFrameWindow.mock.calls.length;

        harness.loader.scheduleIfStale(buildRequest({
            viewport: narrowed(0.95), priceBand: narrowed(0.95),
        }));
        await new Promise((resolve) => { setTimeout(resolve, 300); });

        expect(harness.mocks.fetchFrameWindow.mock.calls.length).toBe(before);
    });
});

describe('WindowLoader and the coarser rungs a reading asked for', () => {
    const DAY_MS = 86_400_000;

    /** The rungs asked for on the last fetch, whatever order they went out in. */
    function askedRungs(harness: Harness): number[] {
        return harness.mocks.fetchPriceBars.mock.calls
            .map((call) => call[0].intervalMs)
            .filter((one) => one === DAY_MS);
    }

    /** A venue with the drawn rung and no candle of the coarser one. */
    function refuseTheDailyRung(harness: Harness): void {
        harness.mocks.fetchPriceBars.mockImplementation((query) => (
            query.intervalMs === DAY_MS
                ? Promise.reject(new Error('No venue candle of that width'))
                : Promise.resolve(EMPTY_BAR_WINDOW)
        ));
    }

    it('fetches a declared rung alongside the drawn one', async () => {
        const harness = buildHarness();

        await harness.loader.load(buildRequest({
            higherBars: [{ intervalMs: DAY_MS, warmupBars: 2 }],
        }));

        expect(askedRungs(harness)).toEqual([DAY_MS]);
    });

    it('asks the rung for the warm-up the reading declared, in its own bars', async () => {
        // Counted in bars of the rung. Inherited from the drawn window instead,
        // a reading over two hundred minutes would ask for two hundred days.
        const harness = buildHarness();

        await harness.loader.load(buildRequest({
            warmupBars: 200,
            higherBars: [{ intervalMs: DAY_MS, warmupBars: 2 }],
        }));

        const asked = harness.mocks.fetchPriceBars.mock.calls
            .map((call) => call[0])
            .find((one) => one.intervalMs === DAY_MS);

        expect(asked?.warmupBars).toBe(2);
    });

    it('still hands the window over when a rung could not be answered', async () => {
        // No venue publishes a candle for every width. A reading that wanted one
        // it cannot have should draw nothing, not take the book down with it.
        const harness = buildHarness();
        refuseTheDailyRung(harness);

        await harness.loader.load(buildRequest({
            higherBars: [{ intervalMs: DAY_MS, warmupBars: 2 }],
        }));

        expect([harness.failures.length, harness.loaded.length]).toEqual([0, 1]);
    });

    it('tells the reading the rung is missing rather than handing it empty bars', async () => {
        const harness = buildHarness();
        refuseTheDailyRung(harness);

        await harness.loader.load(buildRequest({
            higherBars: [{ intervalMs: DAY_MS, warmupBars: 2 }],
        }));

        expect((harness.loaded[0] as LoadedWindow).higher.at(DAY_MS)).toBeNull();
    });

    it('fetches again when a reading is added that reads a rung nobody was reading', async () => {
        // Nothing already loaded can be folded into a daily bar, so the window
        // that was enough a moment ago is not enough now.
        const harness = buildHarness();
        await harness.loader.load(buildRequest({ higherBars: [] }));

        await harness.loader.load(buildRequest({
            higherBars: [{ intervalMs: DAY_MS, warmupBars: 2 }],
        }));

        expect(askedRungs(harness)).toEqual([DAY_MS]);
    });

    it('does not fetch again for a rung the last window already covered', async () => {
        const harness = buildHarness();
        const rungs = [{ intervalMs: DAY_MS, warmupBars: 2 }];
        await harness.loader.load(buildRequest({ higherBars: rungs }));

        await harness.loader.load(buildRequest({ higherBars: rungs }));

        expect(askedRungs(harness)).toEqual([DAY_MS]);
    });
});

describe('WindowLoader and the prices it is willing to ask for', () => {
    /** Every price the loader named on the wire, across every call. */
    function askedPrices(harness: Harness): number[] {
        return harness.mocks.fetchFrameWindow.mock.calls
            .flatMap((call) => {
                const band = (call[0] as { priceBand?: { lowPrice: number; highPrice: number } }).priceBand;
                return band === undefined ? [] : [band.lowPrice, band.highPrice];
            });
    }

    it('never asks for a price the archive could not lay out', async () => {
        // A reader who has not framed itself is asking to be shown the book so
        // it can find its place, and the region that stands for is bounded by
        // the largest number there is. That is arithmetic for the cache, not a
        // price: sent as one it fails the whole window.
        const harness = buildHarness();

        await harness.loader.load(buildRequest({ priceBand: null }));
        await harness.loader.load(buildRequest({
            priceBand: null,
            viewport: { ...VIEWPORT, fromMs: VIEWPORT.fromMs + 400_000, toMs: VIEWPORT.toMs + 400_000 },
        }));

        expect(askedPrices(harness).every((price) => price < Number.MAX_SAFE_INTEGER)).toBe(true);
    });

    it('still says how many rows it has room for while it has no prices', async () => {
        // The rows are what stops an unframed reader being sent every price in
        // the market, so they have to travel even when the prices do not.
        const harness = buildHarness();

        await harness.loader.load(buildRequest({ priceBand: null }));

        const bands = harness.mocks.fetchFrameWindow.mock.calls
            .map((call) => (call[0] as { priceBand?: { maxRows: number } }).priceBand)
            .filter((band) => band !== undefined);
        expect(bands.every((band) => band.maxRows > 0)).toBe(true);
    });
});
