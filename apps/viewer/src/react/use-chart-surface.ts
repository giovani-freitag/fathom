import { ChartGestureController } from '@core/modules/chart/chart-gesture-controller';
import { HeatmapRenderer, type PointerReadout } from '@core/modules/rendering/heatmap-renderer';
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { useKernel } from './kernel-context';
import { useElementSize } from './use-element-size';

/** Retina beyond this buys nothing visible and costs four times the fill rate. */
const MAXIMUM_PIXEL_RATIO = 2;

export interface ChartSurfaceHandles {
    readonly containerRef: RefObject<HTMLDivElement | null>;
    readonly depthCanvasRef: RefObject<HTMLCanvasElement | null>;
    readonly overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
}

/**
 * Wires the canvases, the renderer, and the gesture controller together.
 *
 * Repainting is driven by an animation frame rather than by React: the depth
 * field changes on every streamed second and on every pointer move, and routing
 * that through the reconciler would re-render the whole shell sixty times a
 * second to change pixels React does not own.
 *
 * @returns Refs to attach to the container and the two stacked canvases.
 */
export function useChartSurface(): ChartSurfaceHandles {
    const kernel = useKernel();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const depthCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
        renderer.render({
            viewport: state.viewport,
            dataset: state.dataset,
            colourGain: state.colourGain,
            isTradeOverlayVisible: state.isTradeOverlayVisible,
            isVolumeProfileVisible: state.isVolumeProfileVisible,
            pointer: pointerRef.current,
        });
    }, [kernel]);

    const schedulePaint = useCallback(() => {
        animationFrameRef.current ??= requestAnimationFrame(paint);
    }, [paint]);

    useEffect(() => {
        const depthCanvas = depthCanvasRef.current;
        const overlayCanvas = overlayCanvasRef.current;
        const container = containerRef.current;
        if (depthCanvas === null || overlayCanvas === null || container === null) {
            return;
        }

        const renderer = new HeatmapRenderer({ depthCanvas, overlayCanvas });
        rendererRef.current = renderer;

        const gestures = new ChartGestureController({
            surface: container,
            readViewport: () => kernel.chart.store.read().viewport,
            readSurfaceSize: () => container.getBoundingClientRect(),
            onView: (request) => kernel.chart.applyView(request),
            onPointerMove: (pointer) => {
                pointerRef.current = pointer;
                schedulePaint();
            },
        });
        gestures.attach();

        const unsubscribe = kernel.chart.store.subscribe(schedulePaint);

        return () => {
            unsubscribe();
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

    return { containerRef, depthCanvasRef, overlayCanvasRef };
}
