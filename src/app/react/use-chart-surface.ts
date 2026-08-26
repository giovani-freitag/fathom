import { ChartGestureController } from '../core/chart-gesture-controller.ts';
import { resolveChartLayout } from '../painting/chart-layout.ts';
import { HeatmapRenderer, type PointerReadout } from '../painting/heatmap-renderer.ts';
import { type RefObject, useCallback, useEffect, useRef } from 'react';
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
            isCandleOverlayVisible: state.isCandleOverlayVisible,
            isTradeOverlayVisible: state.isTradeOverlayVisible,
            isVolumeProfileVisible: state.isVolumeProfileVisible,
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
                return resolveChartLayout({
                    cssWidth: bounds.width,
                    cssHeight: bounds.height,
                    isVolumeProfileVisible: kernel.chart.store.read().isVolumeProfileVisible,
                });
            },
            onView: (request) => kernel.chart.applyView(request),
            onPointerMove: (pointer) => {
                pointerRef.current = pointer;
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
