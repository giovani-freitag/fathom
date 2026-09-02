import { ChartGestureController } from '../core/chart-gesture-controller.ts';
import { resolveChartLayout } from '../painting/chart-layout.ts';
import { countPanedPlans, placePanes } from '../painting/pane-projector.ts';
import { findPlanAt } from '../painting/plan-hit-test.ts';
import type { ChartLayout } from '../painting/render-types.ts';
import { HeatmapRenderer, type PointerReadout } from '../painting/heatmap-renderer.ts';
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { DrawingSurfaceClaimant } from '../drawings/drawing-surface-claimant.ts';
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
 * How the chart is divided up, for the room and the plans in force.
 *
 * Measured per call rather than held: the pane count belongs here as much as in
 * the renderer, because it is what decides how tall the price pane is, and a
 * drag divides by that height to turn a finger into a price.
 *
 * @param container - The surface the chart is spread over.
 * @param kernel - The services, for the plans and what is shown beside them.
 * @returns The layout this frame is drawn in.
 */
function resolveSurfaceLayout(container: HTMLElement, kernel: ServiceContainer): ChartLayout {
    const bounds = container.getBoundingClientRect();
    const state = kernel.chart.store.read();
    return resolveChartLayout({
        cssWidth: bounds.width,
        cssHeight: bounds.height,
        isVolumeProfileVisible: state.isVolumeProfileVisible,
        indicatorPaneCount: countPanedPlans(state.plans),
    });
}

/**
 * What maps the surface to the chart, for the viewport and size in force.
 *
 * @param container - The surface the chart is spread over.
 * @param kernel - The services, for the viewport and the pane stack.
 * @returns A projector for this frame.
 */
function resolveSurfaceProjector(
    container: HTMLElement,
    kernel: ServiceContainer,
): ViewportProjector {
    const layout = resolveSurfaceLayout(container, kernel);
    return new ViewportProjector({
        viewport: kernel.chart.store.read().viewport,
        width: layout.plotWidth,
        height: layout.pricePaneHeight,
    });
}

/**
 * Which added layer is drawn under a point, as the frame has it placed.
 *
 * Rebuilt per press rather than held: the panes are placed from the plans and
 * the room, and both move while a reader is looking.
 *
 * @param container - The surface, for the room the panes were placed in.
 * @param kernel - The services, for the viewport and what was drawn.
 * @param point - Where the pointer is, in surface pixels.
 * @returns The instance id of the reading under it, or null.
 */
function readLayerAt(
    container: HTMLElement,
    kernel: ServiceContainer,
    point: { readonly x: number; readonly y: number },
): string | null {
    const state = kernel.chart.store.read();
    const layout = resolveSurfaceLayout(container, kernel);

    return findPlanAt({
        plans: state.plans,
        viewport: state.viewport,
        layout,
        projector: resolveSurfaceProjector(container, kernel),
        panePlacements: placePanes(state.plans, layout.indicatorPanes, state.viewport),
        point,
    });
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
    return pointer === null ? null : resolveSurfaceProjector(container, kernel).xToTime(pointer.x);
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
        const marks = kernel.drawings.store.read();
        const isSettled = renderer.render({
            viewport: state.viewport,
            dataset: state.dataset,
            nowMs: Date.now(),
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
            gridChoice: appearance.gridChoice,
            areGapsVisible: state.areGapsVisible,
            drawings: {
                settled: marks.drawings,
                draft: marks.draft,
                selectedId: marks.selectedId,
            },
        });

        // A layer that is still filling asks for the next frame itself. Nothing
        // else would: a chart nobody is touching schedules no frames, and a book
        // built a slice at a time would stop half drawn.
        if (!isSettled) {
            animationFrameRef.current ??= requestAnimationFrame(paint);
        }
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

        const claimant = new DrawingSurfaceClaimant({
            drawings: kernel.drawings,
            readProjector: () => resolveSurfaceProjector(container, kernel),
            readInstrumentSymbol: () => kernel.chart.store.read().instrumentSymbol,
            readLayerAt: (point) => readLayerAt(container, kernel, point),
            onPickLayer: (instanceId) => { kernel.chart.pickLayer(instanceId); },
        });
        const gestures = new ChartGestureController({
            surface: container,
            readViewport: () => kernel.chart.store.read().viewport,
            readSurfaceSize: () => container.getBoundingClientRect(),
            readLayout: () => resolveSurfaceLayout(container, kernel),
            onView: (request) => kernel.chart.applyView(request),
            onRefitPrice: () => { kernel.chart.refitPrice(); },
            onPointerMove: (pointer) => {
                pointerRef.current = pointer;
                publishCursor(kernel.cursor, readCursorInstant(container, kernel, pointer));
                // A mark waiting for its second click follows the pointer, so a
                // reader sees where the other end lands before committing it.
                if (pointer !== null) {
                    claimant.traceUnpressed(pointer);
                }
                schedulePaint();
            },
            // Given first refusal on every press over the plot, so arming a tool
            // draws a line rather than panning the view under it.
            claimant,
        });
        gestures.attach();

        const unsubscribeChart = kernel.chart.store.subscribe(schedulePaint);
        // The canvas cannot inherit a theme the way the cascade does, so a switch
        // reaches it as one more reason to paint.
        const unsubscribeAppearance = kernel.appearance.store.subscribe(schedulePaint);
        // A mark added, moved or selected changes the picture without touching
        // the chart's own state.
        const unsubscribeDrawings = kernel.drawings.store.subscribe(schedulePaint);

        return () => {
            unsubscribeChart();
            unsubscribeAppearance();
            unsubscribeDrawings();
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
            pricePaneHeightPx: containerRef.current === null
                ? size.height
                : resolveSurfaceLayout(containerRef.current, kernel).pricePaneHeight,
        });
        schedulePaint();
    }, [kernel, schedulePaint, size.height, size.width]);

    return { containerRef, depthCanvasRef, overlayCanvasRef, cursorCanvasRef };
}
