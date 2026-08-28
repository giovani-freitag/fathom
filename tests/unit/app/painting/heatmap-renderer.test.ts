import { beforeEach, describe, expect, it } from 'vitest';
import { createRecordingContext, DEFAULT_VIEWPORT, type RecordingContext } from '../../../mocks/canvas-context.ts';
import { buildFrame } from '../../../mocks/chart-services.ts';
import { EMPTY_DATASET } from '../../../../src/app/core/chart-dataset.ts';
import { EMPTY_DRAWINGS_VIEW } from '../../../../src/app/drawings/drawing-painter.ts';
import { HeatmapRenderer } from '../../../../src/app/painting/heatmap-renderer.ts';
import { resolveChartLayout } from '../../../../src/app/painting/chart-layout.ts';
import type { RenderRequest } from '../../../../src/app/painting/render-types.ts';

interface Surface {
    readonly renderer: HeatmapRenderer;
    readonly overlay: RecordingContext;
    readonly cursor: RecordingContext;
}

function buildSurface(): Surface {
    const depth = createRecordingContext();
    const overlay = createRecordingContext();
    const cursor = createRecordingContext();
    const contexts = [depth, overlay, cursor];
    let handed = 0;

    const canvas = (): HTMLCanvasElement => ({
        width: 0,
        height: 0,
        style: {} as CSSStyleDeclaration,
        getContext: () => contexts[handed++]!.context,
    } as unknown as HTMLCanvasElement);

    const renderer = new HeatmapRenderer({
        depthCanvas: canvas(),
        overlayCanvas: canvas(),
        cursorCanvas: canvas(),
    });
    renderer.resize(1_000, 600, 1);

    return { renderer, overlay, cursor };
}

function buildRequest(overrides: Partial<RenderRequest> = {}): RenderRequest {
    return {
        viewport: DEFAULT_VIEWPORT,
        dataset: { ...EMPTY_DATASET, frames: [buildFrame(DEFAULT_VIEWPORT.fromMs, 78_500)], revision: 1 },
        nowMs: DEFAULT_VIEWPORT.toMs,
        colourGain: 1,
        isDepthVisible: true,
        isCandleOverlayVisible: true,
        isTradeOverlayVisible: true,
        isVolumeProfileVisible: true,
        layerSettings: {},
        pointer: { x: 300, y: 200 },
        locale: 'en',
        plans: [],
        theme: 'dark',
        gridChoice: 'both',
        drawings: EMPTY_DRAWINGS_VIEW,
        ...overrides,
    };
}

describe('HeatmapRenderer layering', () => {
    let surface: Surface;

    beforeEach(() => {
        surface = buildSurface();
    });

    it('holds the data layer while only the cursor moves', () => {
        surface.renderer.render(buildRequest());
        const drawnOnce = surface.overlay.calls.length;

        surface.renderer.render(buildRequest({ pointer: { x: 640, y: 240 } }));

        expect(surface.overlay.calls.length).toBe(drawnOnce);
    });

    it('redraws the cursor layer on every frame', () => {
        surface.renderer.render(buildRequest());
        const drawnOnce = surface.cursor.calls.length;

        surface.renderer.render(buildRequest({ pointer: { x: 640, y: 240 } }));

        expect(surface.cursor.calls.length).toBeGreaterThan(drawnOnce);
    });

    it('redraws the data layer when the recording grew', () => {
        surface.renderer.render(buildRequest());
        const drawnOnce = surface.overlay.calls.length;

        const dataset = { ...EMPTY_DATASET, frames: [buildFrame(DEFAULT_VIEWPORT.fromMs, 78_500)], revision: 2 };
        surface.renderer.render(buildRequest({ dataset }));

        expect(surface.overlay.calls.length).toBeGreaterThan(drawnOnce);
    });

    it('redraws the data layer when the viewport moved', () => {
        surface.renderer.render(buildRequest());
        const drawnOnce = surface.overlay.calls.length;

        const viewport = { ...DEFAULT_VIEWPORT, fromMs: DEFAULT_VIEWPORT.fromMs + 60_000 };
        surface.renderer.render(buildRequest({ viewport }));

        expect(surface.overlay.calls.length).toBeGreaterThan(drawnOnce);
    });

    it('redraws the data layer when the theme flipped', () => {
        surface.renderer.render(buildRequest());
        const drawnOnce = surface.overlay.calls.length;

        surface.renderer.render(buildRequest({ theme: 'light' }));

        expect(surface.overlay.calls.length).toBeGreaterThan(drawnOnce);
    });

    it('redraws the data layer when the language changed', () => {
        surface.renderer.render(buildRequest());
        const drawnOnce = surface.overlay.calls.length;

        surface.renderer.render(buildRequest({ locale: 'pt-BR' }));

        expect(surface.overlay.calls.length).toBeGreaterThan(drawnOnce);
    });

    it('redraws the data layer when a layer was switched off', () => {
        surface.renderer.render(buildRequest());
        const drawnOnce = surface.overlay.calls.length;

        surface.renderer.render(buildRequest({ isCandleOverlayVisible: false }));

        expect(surface.overlay.calls.length).toBeGreaterThan(drawnOnce);
    });
});

describe('HeatmapRenderer containment', () => {
    it('clips the data layers to the region they own', () => {
        // The containment for a plan somebody else produced: vertices running to
        // the edges of the world still cannot reach the axis gutters. It is
        // enforced here rather than trusted to each painter.
        const surface = buildSurface();

        surface.renderer.render(buildRequest());

        const clipped = surface.overlay.calls.findIndex((call) => call.method === 'clip');
        const restored = surface.overlay.calls.findIndex((call) => call.method === 'restore');
        expect(clipped).toBeGreaterThanOrEqual(0);
        expect(restored).toBeGreaterThan(clipped);
    });

    it('keeps what reads as a price inside the pane that has a price axis', () => {
        // Without this the candle at the edge of the band draws down through the
        // oscillator below it and reads as part of that oscillator's line.
        const surface = buildSurface();

        surface.renderer.render(buildRequest({
            plans: [{
                indicatorId: 'rsi',
                labelKey: 'indicator.rsi',
                parameterSummary: '14',
                scale: { kind: 'fixed', low: 0, high: 100 },
                series: [],
                hasConverged: true,
            }],
        }));

        const layout = resolveChartLayout({
            cssWidth: 1_000,
            cssHeight: 600,
            isVolumeProfileVisible: true,
            indicatorPaneCount: 1,
        });
        const clipHeights = surface.overlay.callsTo('rect').map((call) => call.args[3]);
        expect(clipHeights).toContain(layout.pricePaneHeight);
        expect(layout.pricePaneHeight).toBeLessThan(layout.paneStackHeight);
    });

    it('repaints the data layers when an indicator appears', () => {
        // A plan arriving does not move the dataset, so the held layer would
        // otherwise keep showing a chart without it.
        const surface = buildSurface();
        surface.renderer.render(buildRequest());
        const drawnOnce = surface.overlay.calls.length;

        surface.renderer.render(buildRequest({
            plans: [{
                indicatorId: 'ema',
                labelKey: 'indicator.ema',
                parameterSummary: '20',
                scale: { kind: 'price' },
                series: [],
                hasConverged: true,
            }],
        }));

        expect(surface.overlay.calls.length).toBeGreaterThan(drawnOnce);
    });

});

describe('HeatmapRenderer and the marks a reader left', () => {
    const LEVEL = {
        id: 'level',
        kind: 'horizontal-line' as const,
        instrumentSymbol: 'BTCUSDT',
        anchors: [{ atMs: 1_500_000, price: 78_500 }],
        tone: 'phosphor' as const,
    };

    it('redraws the data layer when a mark is moved', () => {
        // The chart holds the layer it drew between frames. A mark that moved
        // without the key moving with it stays drawn where it used to be until
        // something else happens to change.
        const surface = buildSurface();
        surface.renderer.render(buildRequest({
            drawings: { settled: [LEVEL], draft: null, selectedId: null },
        }));
        const before = surface.overlay.callsTo('clearRect').length;

        surface.renderer.render(buildRequest({
            drawings: {
                settled: [{ ...LEVEL, anchors: [{ atMs: 1_500_000, price: 78_600 }] }],
                draft: null,
                selectedId: null,
            },
        }));

        expect(surface.overlay.callsTo('clearRect').length).toBeGreaterThan(before);
    });

    it('holds the data layer while the same marks are drawn', () => {
        const surface = buildSurface();
        const drawings = { settled: [LEVEL], draft: null, selectedId: null };
        surface.renderer.render(buildRequest({ drawings }));
        const before = surface.overlay.callsTo('clearRect').length;

        surface.renderer.render(buildRequest({ drawings }));

        expect(surface.overlay.callsTo('clearRect').length).toBe(before);
    });
});
