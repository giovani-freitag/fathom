import { ChartController } from '../../../src/app/core/chart-controller.ts';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    it('tightens the window to what has actually been recorded', async () => {
        // A browser recording for itself knows nothing of its own extent at
        // first. A window opened wider than anything recorded used to stay that
        // wide for ever: a quarter of an hour of chart holding ten seconds of
        // it, pressed into a sliver at the edge.
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

        // Floored at the narrowest view offered rather than at the ten seconds
        // recorded: below a minute a reader is looking at slabs, not a chart.
        const { viewport } = controller.store.read();
        expect(viewport.toMs - viewport.fromMs).toBe(60_000);
    });
});
