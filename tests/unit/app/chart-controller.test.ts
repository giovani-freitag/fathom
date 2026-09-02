import { ChartController } from '../../../src/app/core/chart-controller.ts';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_BAR_WINDOW } from '../../../src/shared/core/price-bar.ts';
import { EN_DICTIONARY } from '../../../src/app/i18n/dictionaries/en.ts';
import {
    buildFrame,
    buildWindow,
    createChartServiceMocks,
    INSTRUMENT,
} from '../../mocks/chart-services.ts';

import { buildBar, buildWindow as buildBarWindow } from '../../mocks/price-bars.ts';

const SURFACE_WIDTH = 1_000;

function buildController(mocks = createChartServiceMocks()): ChartController {
    return new ChartController({
        api: mocks.api,
        liveFeed: mocks.liveFeed,
        preferences: mocks.preferences,
    });
}

describe('ChartController.initialize', () => {
    it('adopts the instrument the viewer last looked at', async () => {
        const mocks = createChartServiceMocks({ instrumentSymbol: 'BTCUSDT' });
        const controller = buildController(mocks);

        await controller.initialize();

        expect(controller.store.read().instrumentSymbol).toBe('BTCUSDT');
    });

    it('loads a window and reports itself ready', async () => {
        const controller = buildController();

        await controller.initialize();

        expect([
            controller.store.read().phase,
            controller.store.read().dataset.frames.length,
        ]).toEqual(['ready', 1]);
    });

    it('frames the price axis on the book rather than leaving the placeholder', async () => {
        const controller = buildController();

        await controller.initialize();

        const { viewport } = controller.store.read();
        expect(viewport.lowPrice < 79_000 && viewport.highPrice > 79_000).toBe(true);
    });

    it('opens the live tail after the first window lands', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);

        await controller.initialize();

        expect(mocks.connect).toHaveBeenCalledTimes(1);
    });

    it('reports an empty archive rather than an error', async () => {
        const mocks = createChartServiceMocks();
        mocks.fetchInstruments.mockResolvedValue([{ ...INSTRUMENT, lastFrameAtMs: null }]);
        const controller = buildController(mocks);

        await controller.initialize();

        expect(controller.store.read().phase).toBe('empty');
    });

    it('publishes a failure instead of rejecting', async () => {
        const mocks = createChartServiceMocks();
        mocks.fetchInstruments.mockRejectedValue(new Error('gateway unreachable'));
        const controller = buildController(mocks);

        await controller.initialize();

        expect(controller.store.read().phase).toBe('failed');
    });

    it('explains the failure in the interface language', async () => {
        const mocks = createChartServiceMocks();
        mocks.fetchInstruments.mockRejectedValue(new Error('gateway unreachable'));
        const controller = buildController(mocks);

        await controller.initialize();

        expect(controller.store.read().failureKey).toBe('failure.generic');
    });
});

describe('ChartController window loading', () => {
    it('still loads when the surface reports its size mid-flight', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);

        const initializing = controller.initialize();
        controller.applyView({
            viewport: controller.store.read().viewport,
            surfaceWidthPx: SURFACE_WIDTH,
        });
        await initializing;

        expect(controller.store.read().dataset.frames.length).toBe(1);
    });

    it('does not fetch the same window twice', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const callsAfterInit = mocks.fetchFrameWindow.mock.calls.length;

        controller.applyView({
            viewport: controller.store.read().viewport,
            surfaceWidthPx: controller.store.read().viewport.toMs > 0 ? 800 : 800,
        });

        expect(mocks.fetchFrameWindow.mock.calls.length).toBe(callsAfterInit);
    });

    it('requests more than the visible span so a short pan needs no refetch', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);

        await controller.initialize();

        const { viewport } = controller.store.read();
        const query = mocks.fetchFrameWindow.mock.calls[0]?.[0] as { fromMs: number; toMs: number };
        expect(query.toMs - query.fromMs).toBeGreaterThan(viewport.toMs - viewport.fromMs);
    });

    it('keeps the viewport inside the recorded extent', async () => {
        const controller = buildController();
        await controller.initialize();

        controller.applyView({
            viewport: { ...controller.store.read().viewport, fromMs: 0, toMs: 9_000_000 },
            surfaceWidthPx: SURFACE_WIDTH,
        });

        expect(controller.store.read().viewport.toMs).toBeLessThanOrEqual(
            Math.max(Date.now(), INSTRUMENT.lastFrameAtMs ?? 0),
        );
    });
});

describe('ChartController live tail', () => {
    it('extends the window with a streamed frame', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        mocks.deliverFrames(buildWindow([buildFrame(1_600_000)]));

        expect(controller.store.read().dataset.frames.length).toBe(2);
    });

    it('advances the right edge while following the live edge', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = controller.store.read().viewport.toMs;

        mocks.deliverFrames(buildWindow([buildFrame(before + 30_000)]));

        expect(controller.store.read().viewport.toMs).toBeGreaterThan(before);
    });

    it('leaves the viewport alone once the viewer has panned into history', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        controller.applyView({
            viewport: controller.store.read().viewport,
            surfaceWidthPx: SURFACE_WIDTH,
            isFollowingLive: false,
        });
        const before = controller.store.read().viewport.toMs;

        mocks.deliverFrames(buildWindow([buildFrame(before + 30_000)]));

        expect(controller.store.read().viewport.toMs).toBe(before);
    });

    it('records the live status it is told', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        mocks.lastSubscription()?.onStatusChanged('reconnecting');

        expect(controller.store.read().liveStatus).toBe('reconnecting');
    });
});

describe('ChartController layers', () => {
    it('reads what the chart draws out of what was added, not from a flag beside it', async () => {
        const controller = buildController();
        await controller.initialize();

        controller.updateIndicators((current) => current.map((entry) => (
            entry.indicatorId === 'depth'
                ? { ...entry, settings: { ...entry.settings, showProfile: false } }
                : entry
        )));

        expect(controller.store.read().isVolumeProfileVisible).toBe(false);
    });

    it('takes the depth cuts from the layer that owns them', async () => {
        const controller = buildController();
        await controller.initialize();

        controller.updateIndicators((current) => current.map((entry) => (
            entry.indicatorId === 'depth'
                ? { ...entry, settings: { ...entry.settings, colourGain: 2.5 } }
                : entry
        )));

        expect(controller.store.read().colourGain).toBe(2.5);
    });


    it('leaves the window alone when a setting that only repaints is moved', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = mocks.fetchFrameWindow.mock.calls.length;

        controller.updateIndicators((current) => current.map((entry) => (
            entry.indicatorId === 'depth'
                ? { ...entry, settings: { ...entry.settings, showProfile: false } }
                : entry
        )));
        await Promise.resolve();

        expect(mocks.fetchFrameWindow.mock.calls.length).toBe(before);
    });

    it('stops drawing a layer that is hidden rather than removed', async () => {
        const controller = buildController();
        await controller.initialize();

        controller.updateIndicators((current) => current.map((entry) => (
            entry.indicatorId === 'candles' ? { ...entry, isHidden: true } : entry
        )));

        const state = controller.store.read();
        expect(state.isCandleOverlayVisible).toBe(false);
        expect(state.addedIndicators.some((entry) => entry.indicatorId === 'candles')).toBe(true);
    });

    it('remembers the layers it was left with', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        controller.updateIndicators(
            (current) => current.filter((entry) => entry.indicatorId !== 'candles'),
        );

        expect(mocks.writePreferences).toHaveBeenCalledWith(
            expect.objectContaining({
                addedIndicators: expect.not.arrayContaining([
                    expect.objectContaining({ indicatorId: 'candles' }),
                ]),
            }),
        );
    });

    it('releases the live tail when disposed', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        controller.dispose();

        expect(mocks.disconnect).toHaveBeenCalled();
    });
});

describe('ChartController failures', () => {
    it('keeps the chart on screen when a refetch fails', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        mocks.fetchFrameWindow.mockRejectedValue(new Error('gateway unreachable'));

        controller.applyView({
            viewport: { ...controller.store.read().viewport, fromMs: 1_100_000, toMs: 1_400_000 },
            surfaceWidthPx: SURFACE_WIDTH,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));

        expect([
            controller.store.read().phase,
            controller.store.read().dataset.frames.length,
        ]).toEqual(['ready', 1]);
    });

    it('reports the failure even while the chart stays up', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        mocks.fetchFrameWindow.mockRejectedValue(new Error('gateway unreachable'));

        controller.applyView({
            viewport: { ...controller.store.read().viewport, fromMs: 1_100_000, toMs: 1_400_000 },
            surfaceWidthPx: SURFACE_WIDTH,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));

        expect(controller.store.read().failureKey).not.toBeNull();
    });

    it('names a phrase the interface can translate rather than the driver s message', async () => {
        const mocks = createChartServiceMocks();
        mocks.fetchInstruments.mockRejectedValue(new Error('fetch failed'));
        const controller = buildController(mocks);

        await controller.initialize();

        const failureKey = controller.store.read().failureKey!;
        expect(EN_DICTIONARY[failureKey]).not.toContain('fetch failed');
    });

    it('clears the failure once a load succeeds again', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        mocks.fetchFrameWindow.mockRejectedValueOnce(new Error('gateway unreachable'));

        controller.applyView({
            viewport: { ...controller.store.read().viewport, fromMs: 1_100_000, toMs: 1_400_000 },
            surfaceWidthPx: SURFACE_WIDTH,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        controller.applyView({
            viewport: { ...controller.store.read().viewport, fromMs: 1_050_000, toMs: 1_450_000 },
            surfaceWidthPx: SURFACE_WIDTH,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));

        expect(controller.store.read().failureKey).toBeNull();
    });
});

describe('ChartController price following', () => {
    it('leaves the price axis alone while the book is on screen', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = controller.store.read().viewport;

        mocks.deliverFrames(buildWindow([buildFrame(before.toMs + 1_000, 79_000)]));

        expect(controller.store.read().viewport.lowPrice).toBe(before.lowPrice);
    });

    it('recentres once the book has left the screen entirely', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = controller.store.read().viewport;

        mocks.deliverFrames(buildWindow([buildFrame(before.toMs + 1_000, 90_000)]));

        const after = controller.store.read().viewport;
        expect(90_000 > after.lowPrice && 90_000 < after.highPrice).toBe(true);
    });

    it('keeps the price span when it recentres', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = controller.store.read().viewport;

        mocks.deliverFrames(buildWindow([buildFrame(before.toMs + 1_000, 90_000)]));

        const after = controller.store.read().viewport;
        expect(after.highPrice - after.lowPrice).toBeCloseTo(before.highPrice - before.lowPrice, 6);
    });

    it('holds a hand-chosen band even when the touch walks off screen', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const parked = controller.store.read().viewport;
        controller.applyView({
            viewport: { ...parked, lowPrice: 60_000, highPrice: 61_000 },
            surfaceWidthPx: SURFACE_WIDTH,
            isFollowingPrice: false,
        });

        mocks.deliverFrames(buildWindow([buildFrame(parked.toMs + 1_000, 90_000)]));

        expect(controller.store.read().viewport.lowPrice).toBe(60_000);
    });

    it('never drags the price axis while parked in history', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        controller.applyView({
            viewport: controller.store.read().viewport,
            surfaceWidthPx: SURFACE_WIDTH,
            isFollowingLive: false,
        });
        const before = controller.store.read().viewport;

        mocks.deliverFrames(buildWindow([buildFrame(before.toMs + 1_000, 90_000)]));

        expect(controller.store.read().viewport.lowPrice).toBe(before.lowPrice);
    });
});

describe('ChartController.refreshInstruments', () => {
    it('picks up a contract that started recording after the page opened', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const known = controller.store.read().instruments;
        mocks.fetchInstruments.mockResolvedValue([...known, {
            instrumentSymbol: 'ETHUSDT',
            priceBucketSize: 0.5,
            frameIntervalMs: 1_000,
            firstFrameAtMs: 1_000,
            lastFrameAtMs: 2_000,
        }]);

        await controller.refreshInstruments();

        expect(controller.store.read().instruments.map((i) => i.instrumentSymbol))
            .toContain('ETHUSDT');
    });

    it('keeps the contracts it knows when the listing will not answer', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = controller.store.read().instruments;
        mocks.fetchInstruments.mockRejectedValue(new Error('gateway unreachable'));

        await controller.refreshInstruments();

        // A failed refresh must not replace a working screen with an error.
        expect(controller.store.read().instruments).toBe(before);
    });
});

describe('ChartController readiness', () => {
    it('is ready on bars alone, because a chart may load no book at all', async () => {
        // Which body of data is fetched depends on what is on the chart. Read
        // off the book, a candles-only chart looks like a contract nobody ever
        // recorded.
        const mocks = createChartServiceMocks({
            addedIndicators: [
                { instanceId: 'candles-1', indicatorId: 'candles', settings: {}, tone: 'muted' },
            ],
        });
        mocks.fetchPriceBars.mockResolvedValue(buildBarWindow([buildBar(1_500_000, 79_000)]));
        const controller = buildController(mocks);

        await controller.initialize();

        expect(controller.store.read().phase).toBe('ready');
        expect(mocks.fetchFrameWindow).not.toHaveBeenCalled();
    });
});

describe('ChartController.selectBarInterval', () => {
    it('refetches on the rung the reader named', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        controller.selectBarInterval(3_600_000);
        await vi.waitFor(() => {
            const asked = mocks.fetchPriceBars.mock.calls.at(-1)?.[0] as { intervalMs: number };
            expect(asked.intervalMs).toBe(3_600_000);
        });

        expect(controller.store.read().barIntervalMs).toBe(3_600_000);
    });

    it('widens the window so a run of the named rung fits on it', async () => {
        // Left as it was, an hourly bar on a quarter-hour window is one bar the
        // width of the screen: a true picture of nothing.
        const controller = buildController();
        await controller.initialize();
        const before = controller.store.read().viewport;

        controller.selectBarInterval(3_600_000);

        const after = controller.store.read().viewport;
        expect(after.toMs - after.fromMs).toBeGreaterThan(before.toMs - before.fromMs);
    });

    it('hands the choice back to the window when the reader clears it', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        controller.selectBarInterval(3_600_000);

        controller.selectBarInterval(null);

        expect(controller.store.read().barIntervalMs).toBeNull();
        expect(mocks.writePreferences).toHaveBeenCalledWith(
            expect.objectContaining({ barIntervalMs: null }),
        );
    });
});

describe('ChartController on an archive that starts empty', () => {
    it('keeps the window a reader asked for, however little of it was recorded', async () => {
        // It used to be pulled in to the recording, from when the price came
        // out of the recording too. The candles are fetched now: a quarter of an
        // hour is a quarter of an hour on a browser ten seconds old, with the
        // book drawn across the sliver of it that was recorded.
        const mocks = createChartServiceMocks();
        const nowMs = Date.now();
        mocks.fetchInstruments.mockResolvedValue([{
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            frameIntervalMs: 1_000,
            firstFrameAtMs: nowMs - 10_000,
            lastFrameAtMs: nowMs,
        }]);
        const controller = buildController(mocks);
        await controller.initialize();

        act(() => {
            mocks.deliverFrames(buildWindow([buildFrame(nowMs, 79_000)]));
        });

        const { viewport } = controller.store.read();
        expect(viewport.toMs - viewport.fromMs).toBe(900_000);
    });
});

describe('ChartController leaving room after the newest bar', () => {
    it('keeps the clear space to a sliver of a narrow window', async () => {
        // Five minute-bars on a quarter-hour window is a third of the chart
        // left empty, and a reader looking at fifteen minutes did not ask for
        // five minutes of nothing.
        const mocks = createChartServiceMocks();
        const nowMs = Date.now();
        mocks.fetchPriceBars.mockResolvedValue({ ...EMPTY_BAR_WINDOW, intervalMs: 60_000 });
        const controller = buildController(mocks);
        await controller.initialize();

        controller.applyView({
            viewport: { ...controller.store.read().viewport, fromMs: nowMs - 900_000, toMs: nowMs },
            surfaceWidthPx: 1_000,
            isFollowingLive: true,
        });
        await vi.waitFor(() => {
            expect(controller.store.read().dataset.bars.intervalMs).toBe(60_000);
        });

        act(() => { mocks.deliverFrames(buildWindow([buildFrame(nowMs, 79_000)])); });

        const { viewport } = controller.store.read();
        expect(viewport.toMs - nowMs).toBeLessThan((viewport.toMs - viewport.fromMs) * 0.1);
    });
});

describe('ChartController.selectInstrument', () => {
    /** Two contracts to switch between, both recorded. */
    function buildTwoInstrumentMocks(): ReturnType<typeof createChartServiceMocks> {
        const mocks = createChartServiceMocks({ instrumentSymbol: 'BTCUSDT' });
        mocks.fetchInstruments.mockResolvedValue([
            INSTRUMENT,
            { ...INSTRUMENT, instrumentSymbol: 'ETHUSDT' },
        ]);
        return mocks;
    }

    it('points the chart at the contract it was given', async () => {
        const mocks = buildTwoInstrumentMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        act(() => { controller.selectInstrument('ETHUSDT'); });
        await vi.waitFor(() => { expect(controller.store.read().phase).not.toBe('loading'); });

        expect(controller.store.read().instrumentSymbol).toBe('ETHUSDT');
    });

    it('ignores a contract that has never been recorded', async () => {
        const mocks = buildTwoInstrumentMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        controller.selectInstrument('DOGEUSDT');

        expect(controller.store.read().instrumentSymbol).toBe('BTCUSDT');
    });

    it('lets go of the tail on the contract it is leaving', async () => {
        // Still open, it keeps delivering, and a frame message names no
        // instrument: the chart appends one contract's liquidity to the other's.
        const mocks = buildTwoInstrumentMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        mocks.disconnect.mockClear();

        controller.selectInstrument('ETHUSDT');

        expect(mocks.disconnect).toHaveBeenCalled();
    });

});


describe('ChartController and a store that lags the recording', () => {


    it('asks the tail for the prices the window was read over', async () => {
        // A whole-book store holds some fifteen thousand prices and a chart
        // draws about sixty. Measured on the live gateway, the tail was sending
        // sixty-two kilobytes a second for a picture that had room for a four
        // hundredth of it, and the reader's own drawing thread threw the rest
        // away as it arrived.
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);

        await controller.initialize();

        const band = mocks.lastSubscription()?.priceBand;
        expect(band !== undefined && band.lowPrice < 79_000 && band.highPrice > 79_000).toBe(true);
    });

    it('reopens the tail on the prices the reader panned onto', async () => {
        // A tail left reading where the chart was leaves the prices it has just
        // moved onto standing still, and only the next gesture would fill them.
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = mocks.lastSubscription()?.priceBand;

        const parked = controller.store.read().viewport;
        controller.applyView({
            viewport: { ...parked, lowPrice: 60_000, highPrice: 61_000 },
            surfaceWidthPx: SURFACE_WIDTH,
            isFollowingPrice: false,
        });

        await vi.waitFor(() => {
            expect(mocks.lastSubscription()?.priceBand).not.toEqual(before);
        });
    });
});

describe('ChartController and a window read on a folded grid', () => {
    /** One instant already laid on a fifty dollar grid, as a wide read answers. */
    const COARSE_WINDOW = {
        priceBucketSize: 50,
        sampleIntervalMs: 1_000,
        frames: [{
            capturedAtMs: 1_500_000,
            bestBidPrice: 78_999.5,
            bestAskPrice: 79_000.5,
            bids: { lowestBucketIndex: 1_578, quantities: Float32Array.from([1, 2, 3]) },
            asks: { lowestBucketIndex: 1_581, quantities: Float32Array.from([3, 2, 1]) },
        }],
    };

    it('lays a streamed instant on the grid the window came back on', async () => {
        // The tail reads the recording as written, on the fine grid. Appended
        // as it arrives, every price in it lands at a fifth of where it belongs
        // and the chart draws liquidity nobody offered.
        const mocks = createChartServiceMocks();
        mocks.fetchFrameWindow.mockResolvedValue(COARSE_WINDOW);
        const controller = buildController(mocks);
        await controller.initialize();

        act(() => {
            mocks.deliverFrames(buildWindow([buildFrame(1_600_000)]));
        });

        const frames = controller.store.read().dataset.frames;
        expect(frames.at(-1)?.bids.lowestBucketIndex).toBe(1_579);
    });

    it('still takes the instant, rather than dropping what it cannot lay flat', async () => {
        const mocks = createChartServiceMocks();
        mocks.fetchFrameWindow.mockResolvedValue(COARSE_WINDOW);
        const controller = buildController(mocks);
        await controller.initialize();

        act(() => {
            mocks.deliverFrames(buildWindow([buildFrame(1_600_000)]));
        });

        expect(controller.store.read().dataset.frames.at(-1)?.capturedAtMs).toBe(1_600_000);
    });
});

describe('ChartController following a recording rather than a clock', () => {
    it('holds the right edge to the newest instant a gesture arrives on', async () => {
        // Between gestures the edge only ever moves when a frame lands, so a
        // store written a few columns at a time is invisible. A gesture pins the
        // edge to the wall clock instead, and those seconds sit on screen as
        // blank until the store catches up to where the clock was.
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        const newestMs = controller.store.read().dataset.frames.at(-1)!.capturedAtMs;
        const nowMs = Date.now();
        controller.applyView({
            viewport: { ...controller.store.read().viewport, fromMs: nowMs - 900_000, toMs: nowMs },
            surfaceWidthPx: SURFACE_WIDTH,
            isFollowingLive: true,
        });

        expect(controller.store.read().viewport.toMs).toBeLessThanOrEqual(newestMs + 60_000);
    });

    it('keeps the span the gesture asked for while it pulls the edge back', async () => {
        // A gesture that zoomed still has to zoom.
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        const nowMs = Date.now();
        controller.applyView({
            viewport: { ...controller.store.read().viewport, fromMs: nowMs - 900_000, toMs: nowMs },
            surfaceWidthPx: SURFACE_WIDTH,
            isFollowingLive: true,
        });

        const { fromMs, toMs } = controller.store.read().viewport;
        expect(toMs - fromMs).toBe(900_000);
    });

    it('leaves a reader who panned away from the live edge where they put it', async () => {
        // Pulled back, a reader looking at last hour would be yanked to the
        // present on every drag.
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        const nowMs = Date.now();
        controller.applyView({
            viewport: { ...controller.store.read().viewport, fromMs: nowMs - 900_000, toMs: nowMs },
            surfaceWidthPx: SURFACE_WIDTH,
            isFollowingLive: false,
        });

        expect(controller.store.read().viewport.toMs).toBeGreaterThan(nowMs - 600_000);
    });
});

describe('ChartController opening on a listed price', () => {
    it('frames the axis before it asks for a window', async () => {
        // Without the price in the listing, a chart has to read a whole book to
        // find the market — measured, two seconds and a request every other one
        // on the page queued behind, with nothing drawn until it landed.
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);

        await controller.initialize();

        const { lowPrice, highPrice } = controller.store.read().viewport;
        expect(lowPrice).toBeLessThan(highPrice);
    });

    it('asks the very first window for the band it will draw', async () => {
        // A band of nothing is a reader saying it does not know where to look,
        // and a whole-book store answers that with every price it holds.
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);

        await controller.initialize();
        const first = mocks.fetchFrameWindow.mock.calls[0]?.[0] as
            { priceBand?: { lowPrice: number; highPrice: number } };

        expect(first.priceBand?.highPrice).toBeGreaterThan(first.priceBand?.lowPrice ?? 0);
    });

    it('reads one window rather than one to look and another to draw', async () => {
        // Unframed, the chart reads a whole book, reframes on what came back
        // and reads again. Both are paid before anything is drawn.
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);

        await controller.initialize();

        expect(mocks.fetchFrameWindow).toHaveBeenCalledTimes(1);
    });

    it('opens around the price it was told, not around nought', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);

        await controller.initialize();

        const { lowPrice, highPrice } = controller.store.read().viewport;
        expect((lowPrice + highPrice) / 2).toBeCloseTo(79_000, -2);
    });
});

describe('ChartController and the prices a new span is drawn against', () => {
    /** The band each window was asked for, oldest first; null where it named none. */
    function bandsAskedFor(mocks: ReturnType<typeof createChartServiceMocks>) {
        return mocks.fetchFrameWindow.mock.calls.map((call) => (
            (call[0] as { priceBand?: { lowPrice: number; highPrice: number } }).priceBand ?? null
        ));
    }

    /**
     * Whether the chart went back to the whole book to frame itself again.
     *
     * A band naming no prices is how that is asked for: nought to nought, which
     * the wire drops entirely rather than sending as a range.
     */
    function didReframe(mocks: ReturnType<typeof createChartServiceMocks>, after: number): boolean {
        return bandsAskedFor(mocks).slice(after)
            .some((band) => band === null || !(band.highPrice > band.lowPrice));
    }

    it('asks for the book again when the reader changes how much time is on screen', async () => {
        // Every price bound is carried over from the view before. A reader who
        // looked at a week and then asked for fifteen minutes gets a quarter of
        // an hour drawn against a week of price: one flat line, no way back.
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const wide = controller.store.read().viewport;
        controller.applyView({
            viewport: { ...wide, lowPrice: 10_000, highPrice: 90_000 },
            surfaceWidthPx: SURFACE_WIDTH,
        });
        await vi.waitFor(() => expect(bandsAskedFor(mocks).length).toBeGreaterThan(1));
        const before = bandsAskedFor(mocks).length;

        controller.applyView({
            viewport: {
                ...controller.store.read().viewport,
                fromMs: wide.toMs - 900_000,
                toMs: wide.toMs,
            },
            surfaceWidthPx: SURFACE_WIDTH,
            isRefittingPrice: true,
        });

        // The whole book, then the band it framed to. What matters is that it
        // went back to the book at all.
        await vi.waitFor(() => expect(didReframe(mocks, before)).toBe(true));
        expect(didReframe(mocks, before)).toBe(true);
    });

    it('keeps the band a reader chose when they are only panning', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const held = controller.store.read().viewport;
        controller.applyView({
            viewport: { ...held, lowPrice: 10_000, highPrice: 90_000 },
            surfaceWidthPx: SURFACE_WIDTH,
        });
        await vi.waitFor(() => expect(bandsAskedFor(mocks).length).toBeGreaterThan(1));
        const before = bandsAskedFor(mocks).length;

        controller.applyView({
            viewport: {
                ...controller.store.read().viewport,
                fromMs: held.fromMs + 60_000,
                toMs: held.toMs + 60_000,
            },
            surfaceWidthPx: SURFACE_WIDTH,
        });

        expect(didReframe(mocks, before)).toBe(false);
    });
});

describe('ChartController keeping the listing current', () => {
    /** Pretends the tab is hidden or looked at, and says so. */
    function setVisibility(state: 'visible' | 'hidden'): void {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => state,
        });
        document.dispatchEvent(new Event('visibilitychange'));
    }

    it('stops asking while nobody is looking at the tab', async () => {
        // Coverage grows a second a second and the picker changes only when a
        // contract is switched on. Asked for on a timer in a hidden tab, it is
        // a round trip a minute for a figure nothing is showing.
        vi.useFakeTimers();
        try {
            const mocks = createChartServiceMocks();
            const controller = buildController(mocks);
            await controller.initialize();
            setVisibility('hidden');
            const asked = mocks.fetchInstruments.mock.calls.length;

            await vi.advanceTimersByTimeAsync(120_000);

            expect(mocks.fetchInstruments.mock.calls.length).toBe(asked);
            controller.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it('catches up the moment the tab is looked at again', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        setVisibility('hidden');
        const asked = mocks.fetchInstruments.mock.calls.length;

        setVisibility('visible');

        await vi.waitFor(() => {
            expect(mocks.fetchInstruments.mock.calls.length).toBeGreaterThan(asked);
        });
        controller.dispose();
    });

    it('stops listening once it is disposed', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        controller.dispose();
        const asked = mocks.fetchInstruments.mock.calls.length;

        setVisibility('visible');

        expect(mocks.fetchInstruments.mock.calls.length).toBe(asked);
    });
});
