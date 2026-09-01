import { ChartController } from '../../../src/app/core/chart-controller.ts';
import { buildFrame, createChartServiceMocks, INSTRUMENT } from '../../mocks/chart-services.ts';
import { describe, expect, it } from 'vitest';
import type { LiquidityFrame, LiquidityFrameWindow } from '../../../src/shared/core/liquidity-frame.ts';

const SURFACE_WIDTH = 1_600;
const PANE_HEIGHT = 900;
/** The grid the archive records on, which is the finest any read can answer. */
const FINEST_BUCKET_SIZE = 10;
const FINEST_INTERVAL_MS = 1_000;
/** Where the recording stops, with days of it behind. */
const RECORDING_ENDED_AT_MS = 1_700_000_000_000;

/**
 * An archive that answers the way the real one does.
 *
 * The point of the mock is the part the chart has to cope with: a wide window
 * comes back on a coarse grid, because the archive folds instants and prices
 * together to keep a wide read cheap. Answered on one fixed grid however much
 * was asked for, the mock would agree with every wrong thing the chart could do
 * about zooming out and back in.
 */
function buildArchive() {
    const mocks = createChartServiceMocks();
    // Days of it, not the handful of minutes the shared fixture reports: the
    // view is clamped to what was recorded, so a chart panned against a short
    // recording does not move and every reading of the gesture is of nothing.
    mocks.fetchInstruments.mockResolvedValue([{
        ...INSTRUMENT,
        firstFrameAtMs: RECORDING_ENDED_AT_MS - 5 * 24 * 3_600_000,
        lastFrameAtMs: RECORDING_ENDED_AT_MS,
    }]);
    mocks.fetchFrameWindow.mockImplementation((query) => {
        const spanMs = query.toMs - query.fromMs;
        const wanted = spanMs / Math.max(1, query.maxColumns) / FINEST_INTERVAL_MS;
        const fold = 4 ** Math.max(0, Math.floor(Math.log2(Math.max(1, wanted)) / 2));
        const sampleIntervalMs = FINEST_INTERVAL_MS * fold;
        const frames: LiquidityFrame[] = [];
        // Anchored to the clock, as the archive is: two overlapping reads have
        // to agree instant for instant or nothing can be kept between them.
        const first = Math.ceil(query.fromMs / sampleIntervalMs) * sampleIntervalMs;
        for (let at = first; at <= query.toMs; at += sampleIntervalMs) {
            frames.push(buildFrame(at));
        }
        return Promise.resolve({
            priceBucketSize: FINEST_BUCKET_SIZE * fold,
            sampleIntervalMs,
            frames,
        } satisfies LiquidityFrameWindow);
    });
    return mocks;
}

/** A chart already open on the archive, ready to be moved about. */
async function openChart() {
    const mocks = buildArchive();
    const controller = new ChartController({
        api: mocks.api, liveFeed: mocks.liveFeed, preferences: mocks.preferences,
    });
    await controller.initialize();
    return { controller, mocks };
}

/** Moves the view and waits for whatever it set off. */
async function gesture(
    controller: ChartController,
    move: (viewport: ChartViewport) => ChartViewport,
): Promise<void> {
    const viewport = move(controller.store.read().viewport);
    controller.applyView({
        viewport,
        surfaceWidthPx: SURFACE_WIDTH,
        pricePaneHeightPx: PANE_HEIGHT,
        isFollowingLive: false,
        isGestureOver: true,
    });
    // Twice: the load resolves on one turn and what it sets off on the next.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
}

type ChartViewport = ReturnType<ChartController['store']['read']>['viewport'];

/** The stretch of time the chart is showing. */
function spanOf(viewport: ChartViewport): number {
    return viewport.toMs - viewport.fromMs;
}

/** Whether the window held covers every instant the view is showing. */
function coversTheView(controller: ChartController): boolean {
    const { dataset, viewport } = controller.store.read();
    const first = dataset.frames[0];
    const last = dataset.frames.at(-1);
    if (first === undefined || last === undefined) {
        return false;
    }
    return first.capturedAtMs <= viewport.fromMs + dataset.sampleIntervalMs
        && last.capturedAtMs >= viewport.toMs - dataset.sampleIntervalMs;
}

describe('walking back through history and forward again', () => {
    it('holds a window covering the view at every step', async () => {
        // Every step is a whole gesture, and after each one the chart draws from
        // what it holds until the next arrives. A step that leaves the view
        // reaching past the window is a blank stretch of chart beside candles
        // that are drawn, which reads as a hole in the recording.
        const { controller } = await openChart();
        const covered: boolean[] = [];

        for (let step = 0; step < 5; step += 1) {
            await gesture(controller, (viewport) => ({
                ...viewport,
                fromMs: viewport.fromMs - spanOf(viewport) * 0.9,
                toMs: viewport.toMs - spanOf(viewport) * 0.9,
            }));
            covered.push(coversTheView(controller));
        }

        expect(covered).toEqual([true, true, true, true, true]);
    });

    it('comes back to where it started holding the same grid', async () => {
        const { controller } = await openChart();
        const before = controller.store.read().dataset.sampleIntervalMs;

        for (let step = 0; step < 3; step += 1) {
            await gesture(controller, (viewport) => ({
                ...viewport,
                fromMs: viewport.fromMs - spanOf(viewport) * 0.9,
                toMs: viewport.toMs - spanOf(viewport) * 0.9,
            }));
        }
        for (let step = 0; step < 3; step += 1) {
            await gesture(controller, (viewport) => ({
                ...viewport,
                fromMs: viewport.fromMs + spanOf(viewport) * 0.9,
                toMs: viewport.toMs + spanOf(viewport) * 0.9,
            }));
        }

        expect(controller.store.read().dataset.sampleIntervalMs).toBe(before);
    });

    it('asks for less than a whole window once it has one to add to', async () => {
        // A pan of most of a screen still leaves half the new window inside the
        // old one, because the window reaches well past the view on both sides.
        const { controller, mocks } = await openChart();
        const step = (viewport: ChartViewport) => ({
            ...viewport,
            fromMs: viewport.fromMs - spanOf(viewport) * 0.9,
            toMs: viewport.toMs - spanOf(viewport) * 0.9,
        });
        // One step first, so what is held was read for the surface the next
        // step is on: a window read for another surface is on another grid, and
        // nothing can be kept between two grids.
        await gesture(controller, step);
        const whole = mocks.fetchFrameWindow.mock.calls.at(-1)?.[0];
        const wholeSpan = (whole?.toMs ?? 0) - (whole?.fromMs ?? 0);

        await gesture(controller, step);

        const last = mocks.fetchFrameWindow.mock.calls.at(-1)?.[0];
        expect((last?.toMs ?? 0) - (last?.fromMs ?? 0)).toBeLessThan(wholeSpan);
    });
});

describe('zooming out and back in', () => {
    it('draws a coarser grid out and a finer one back in', async () => {
        // The whole class of bug this locks: a chart that thickened and would
        // not thin again. Every level of the archive is coarser than the one
        // below, so zooming out is meant to coarsen — and zooming back in is
        // meant to undo it.
        const { controller } = await openChart();
        const opened = controller.store.read().dataset.sampleIntervalMs;

        await gesture(controller, (viewport) => ({
            ...viewport,
            fromMs: viewport.toMs - spanOf(viewport) * 64,
        }));
        const wide = controller.store.read().dataset.sampleIntervalMs;
        await gesture(controller, (viewport) => ({
            ...viewport,
            fromMs: viewport.toMs - spanOf(viewport) / 64,
        }));
        const close = controller.store.read().dataset.sampleIntervalMs;

        expect([wide > opened, close < wide, close <= opened]).toEqual([true, true, true]);
    });

    it('sharpens the rows again as well, which is what a thick bar is', async () => {
        const { controller } = await openChart();

        await gesture(controller, (viewport) => ({
            ...viewport,
            fromMs: viewport.toMs - spanOf(viewport) * 64,
        }));
        const wide = controller.store.read().dataset.priceBucketSize;
        await gesture(controller, (viewport) => ({
            ...viewport,
            fromMs: viewport.toMs - spanOf(viewport) / 64,
        }));

        expect(controller.store.read().dataset.priceBucketSize).toBeLessThan(wide);
    });
});

describe('moving the price axis', () => {
    it('ends up holding a window over the prices it was moved to', async () => {
        // A window clipped to a band holds nothing above or below it, so a
        // reader who dragged the axis off it is looking at blank chart until it
        // is asked for again.
        const { controller, mocks } = await openChart();

        await gesture(controller, (viewport) => {
            const span = viewport.highPrice - viewport.lowPrice;
            return {
                ...viewport,
                lowPrice: viewport.lowPrice + span * 3,
                highPrice: viewport.highPrice + span * 3,
            };
        });

        const band = mocks.fetchFrameWindow.mock.calls.at(-1)?.[0].priceBand;
        const { viewport } = controller.store.read();
        expect([
            (band?.lowPrice ?? Infinity) <= viewport.lowPrice,
            (band?.highPrice ?? 0) >= viewport.highPrice,
        ]).toEqual([true, true]);
    });

    it('leaves the window alone while the view still nearly fills the band', async () => {
        // Asked again on every step, a pinch would be a request a frame.
        const { controller, mocks } = await openChart();
        const before = mocks.fetchFrameWindow.mock.calls.length;

        await gesture(controller, (viewport) => {
            const span = viewport.highPrice - viewport.lowPrice;
            return {
                ...viewport,
                lowPrice: viewport.lowPrice + span * 0.02,
                highPrice: viewport.highPrice + span * 0.02,
            };
        });

        expect(mocks.fetchFrameWindow.mock.calls.length).toBe(before);
    });
});
