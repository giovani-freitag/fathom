import { beforeEach, describe, expect, it } from 'vitest';
import { createRecordingContext, DEFAULT_VIEWPORT, type RecordingContext } from '../../../mocks/canvas-context.ts';
import { buildFrame } from '../../../mocks/chart-services.ts';
import { EMPTY_DATASET } from '../../../../src/app/core/chart-dataset.ts';
import { HeatmapRenderer } from '../../../../src/app/painting/heatmap-renderer.ts';
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
        colourGain: 1,
        isCandleOverlayVisible: true,
        isTradeOverlayVisible: true,
        isVolumeProfileVisible: true,
        pointer: { x: 300, y: 200 },
        locale: 'en',
        theme: 'dark',
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
