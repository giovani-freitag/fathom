import { ChartController } from '../../../src/app/core/chart-controller.ts';
import { describe, expect, it } from 'vitest';
import {
    buildFrame,
    buildWindow,
    createChartServiceMocks,
    INSTRUMENT,
} from '../../mocks/chart-services.ts';

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

        expect(controller.store.read().errorMessage).toBe('Não foi possível carregar a janela.');
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

        mocks.lastSubscription()?.onFrames(buildWindow([buildFrame(1_600_000)]));

        expect(controller.store.read().dataset.frames.length).toBe(2);
    });

    it('advances the right edge while following the live edge', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = controller.store.read().viewport.toMs;

        mocks.lastSubscription()?.onFrames(buildWindow([buildFrame(before + 30_000)]));

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

        mocks.lastSubscription()?.onFrames(buildWindow([buildFrame(before + 30_000)]));

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

describe('ChartController settings', () => {
    it('applies a display change immediately', async () => {
        const controller = buildController();
        await controller.initialize();

        controller.updateSettings({ colourGain: 3 });

        expect(controller.store.read().colourGain).toBe(3);
    });

    it('remembers a display change', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();

        controller.updateSettings({ isVolumeProfileVisible: false });

        expect(mocks.writePreferences).toHaveBeenCalledWith(
            expect.objectContaining({ isVolumeProfileVisible: false }),
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

        expect(controller.store.read().errorMessage).not.toBeNull();
    });

    it('answers in the interface language rather than the driver s', async () => {
        const mocks = createChartServiceMocks();
        mocks.fetchInstruments.mockRejectedValue(new Error('fetch failed'));
        const controller = buildController(mocks);

        await controller.initialize();

        expect(controller.store.read().errorMessage).not.toContain('fetch failed');
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

        expect(controller.store.read().errorMessage).toBeNull();
    });
});

describe('ChartController price following', () => {
    it('leaves the price axis alone while the book is on screen', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = controller.store.read().viewport;

        mocks.lastSubscription()?.onFrames(buildWindow([buildFrame(before.toMs + 1_000, 79_000)]));

        expect(controller.store.read().viewport.lowPrice).toBe(before.lowPrice);
    });

    it('recentres once the book has left the screen entirely', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = controller.store.read().viewport;

        mocks.lastSubscription()?.onFrames(buildWindow([buildFrame(before.toMs + 1_000, 90_000)]));

        const after = controller.store.read().viewport;
        expect(90_000 > after.lowPrice && 90_000 < after.highPrice).toBe(true);
    });

    it('keeps the price span when it recentres', async () => {
        const mocks = createChartServiceMocks();
        const controller = buildController(mocks);
        await controller.initialize();
        const before = controller.store.read().viewport;

        mocks.lastSubscription()?.onFrames(buildWindow([buildFrame(before.toMs + 1_000, 90_000)]));

        const after = controller.store.read().viewport;
        expect(after.highPrice - after.lowPrice).toBeCloseTo(before.highPrice - before.lowPrice, 6);
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

        mocks.lastSubscription()?.onFrames(buildWindow([buildFrame(before.toMs + 1_000, 90_000)]));

        expect(controller.store.read().viewport.lowPrice).toBe(before.lowPrice);
    });
});
