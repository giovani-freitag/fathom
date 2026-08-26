import { ChartGestureController } from '../core/chart-gesture-controller.ts';
import { resolveChartLayout } from '../painting/chart-layout.ts';
import { countPanedPlans } from '../painting/pane-projector.ts';
import { HeatmapRenderer, type PointerReadout } from '../painting/heatmap-renderer.ts';
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { publishCursor } from '../core/cursor-store.ts';
import type { ServiceContainer } from '../core/service-container.ts';
import { ViewportProjector } from '../core/viewport-projector.ts';
import { useKernel } from './kernel-context.ts';
import { useElementSize } from './use-element-size.ts';

/** Retina beyond this buys nothing visible and costs four times the fill rate. */
const MAXIMUM_PIXEL_RATIO = 2;

export interface ChartSurfaceHandles {
    readonly containerRef: RefObject<HTMLDivElement | null>;
    readonly depthCanvasRef: RefObject<HTMLCanvasElement | null>;
    readonly overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
    readonly cursorCanvasRef: RefObject<HTMLCanvasElement | null>;
}

/**
 * The instant under the pointer, in the viewport in force.
 *
 * @param container - The surface, for the width the viewport is spread over.
 * @param kernel - The services, for that viewport.
 * @param pointer - Where the pointer is, or null once it has left.
 * @returns The instant, or null when there is no pointer on the chart.
 */
function readCursorInstant(
    container: HTMLElement,
    kernel: ServiceContainer,
    pointer: PointerReadout | null,
): number | null {
    if (pointer === null) {
        return null;
    }
    const bounds = container.getBoundingClientRect();
    const state = kernel.chart.store.read();
    const layout = resolveChartLayout({
        cssWidth: bounds.width,
        cssHeight: bounds.height,
        isVolumeProfileVisible: state.isVolumeProfileVisible,
        indicatorPaneCount: countPanedPlans(state.plans),
    });

    return new ViewportProjector({
        viewport: state.viewport,
        width: layout.plotWidth,
        height: layout.pricePaneHeight,
    }).xToTime(pointer.x);
}

/**
 * Wires the canvases, the renderer, and the gesture controller together.
 *
 * @returns Refs to attach to the container and the two stacked canvases.
 */
export function useChartSurface(): ChartSurfaceHandles {
    const kernel = useKernel();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const depthCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);

    const rendererRef = useRef<HeatmapRenderer | null>(null);
    const pointerRef = useRef<PointerReadout | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const size = useElementSize(containerRef);

    const paint = useCallback(() => {
        animationFrameRef.current = null;
        const renderer = rendererRef.current;
        if (renderer === null) {
            return;
        }
        const state = kernel.chart.store.read();
        const appearance = kernel.appearance.store.read();
        renderer.render({
            viewport: state.viewport,
            dataset: state.dataset,
            colourGain: state.colourGain,
            isDepthVisible: state.isDepthVisible,
            isCandleOverlayVisible: state.isCandleOverlayVisible,
            layerSettings: state.layerSettings,
            isTradeOverlayVisible: state.isTradeOverlayVisible,
            isVolumeProfileVisible: state.isVolumeProfileVisible,
            plans: state.plans,
            pointer: pointerRef.current,
            locale: appearance.locale,
            theme: appearance.resolvedTheme,
        });
    }, [kernel]);

    const schedulePaint = useCallback(() => {
        animationFrameRef.current ??= requestAnimationFrame(paint);
    }, [paint]);

    useEffect(() => {
        const depthCanvas = depthCanvasRef.current;
        const overlayCanvas = overlayCanvasRef.current;
        const cursorCanvas = cursorCanvasRef.current;
        const container = containerRef.current;
        if (depthCanvas === null || overlayCanvas === null || cursorCanvas === null || container === null) {
            return;
        }

        const renderer = new HeatmapRenderer({ depthCanvas, overlayCanvas, cursorCanvas });
        rendererRef.current = renderer;

        const gestures = new ChartGestureController({
            surface: container,
            readViewport: () => kernel.chart.store.read().viewport,
            readSurfaceSize: () => container.getBoundingClientRect(),
            readLayout: () => {
                const bounds = container.getBoundingClientRect();
                const state = kernel.chart.store.read();
                // The pane count belongs here as much as in the renderer: it is
                // what decides how tall the price pane is, and a drag divides by
                // that height to turn a finger into a price.
                return resolveChartLayout({
                    cssWidth: bounds.width,
                    cssHeight: bounds.height,
                    isVolumeProfileVisible: state.isVolumeProfileVisible,
                    indicatorPaneCount: countPanedPlans(state.plans),
                });
            },
            onView: (request) => kernel.chart.applyView(request),
            onRefitPrice: () => { kernel.chart.refitPrice(); },
            onPointerMove: (pointer) => {
                pointerRef.current = pointer;
                publishCursor(kernel.cursor, readCursorInstant(container, kernel, pointer));
                schedulePaint();
            },
        });
        gestures.attach();

        const unsubscribeChart = kernel.chart.store.subscribe(schedulePaint);
        // The canvas cannot inherit a theme the way the cascade does, so a switch
        // reaches it as one more reason to paint.
        const unsubscribeAppearance = kernel.appearance.store.subscribe(schedulePaint);

        return () => {
            unsubscribeChart();
            unsubscribeAppearance();
            gestures.detach();
            renderer.dispose();
            rendererRef.current = null;
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [kernel, schedulePaint]);

    useEffect(() => {
        if (size.width === 0 || size.height === 0) {
            return;
        }
        const pixelRatio = Math.min(window.devicePixelRatio || 1, MAXIMUM_PIXEL_RATIO);
        rendererRef.current?.resize(size.width, size.height, pixelRatio);
        kernel.chart.applyView({
            viewport: kernel.chart.store.read().viewport,
            surfaceWidthPx: size.width,
        });
        schedulePaint();
    }, [kernel, schedulePaint, size.height, size.width]);

    return { containerRef, depthCanvasRef, overlayCanvasRef, cursorCanvasRef };
}
