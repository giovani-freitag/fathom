import { buildTranslate } from '../../src/app/i18n/translator.ts';
import { EMPTY_DRAWINGS_VIEW } from '../../src/app/drawings/drawing-painter.ts';
import type { ChartViewport } from '../../src/app/core/chart-viewport.ts';
import { choosePriceTicks, chooseTimeTicks } from '../../src/app/painting/axis-ticks.ts';
import { ViewportProjector } from '../../src/app/core/viewport-projector.ts';
import type { ChartDataset } from '../../src/app/core/chart-dataset.ts';
import { EMPTY_DATASET } from '../../src/app/core/chart-dataset.ts';
import { resolveChartLayout } from '../../src/app/painting/chart-layout.ts';
import { countPanedPlans, placePanes } from '../../src/app/painting/pane-projector.ts';
import type { PaintContext, RenderRequest } from '../../src/app/painting/render-types.ts';

export interface RecordedCall {
    readonly method: string;
    readonly args: readonly unknown[];
    /** Fill and stroke styles in force when the call was made. */
    readonly fillStyle: string;
    readonly strokeStyle: string;
    /** How heavy the line was, and how its ends were finished. */
    readonly lineWidth: number;
    readonly lineCap: string;
}

export interface RecordingContext {
    readonly context: CanvasRenderingContext2D;
    readonly calls: RecordedCall[];
    callsTo: (method: string) => RecordedCall[];
}

const RECORDED_METHODS = [
    'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo',
    'stroke', 'arc', 'fill', 'setLineDash', 'fillText', 'drawImage',
    'putImageData', 'save', 'restore', 'closePath', 'roundRect', 'setTransform',
    'rect', 'clip',
] as const;

/** What a recorded call answers with, for the few that must answer something. */
const ANSWERS: Readonly<Record<string, () => unknown>> = {
    // Handed straight back as a fill style, so the stops it takes are all a
    // recording needs of it.
    createLinearGradient: () => ({ addColorStop: () => undefined }),
};

/**
 * A 2D context that records what was asked of it.
 *
 * Painters are pure in everything but their draw calls, so recording those is
 * the whole assertion surface — and it works in jsdom, which has no real canvas.
 */
export function createRecordingContext(): RecordingContext {
    const calls: RecordedCall[] = [];
    const state = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt' };

    const recorder: Record<string, unknown> = {
        get fillStyle() { return state.fillStyle; },
        set fillStyle(value: string) { state.fillStyle = value; },
        get strokeStyle() { return state.strokeStyle; },
        set strokeStyle(value: string) { state.strokeStyle = value; },
        get lineWidth() { return state.lineWidth; },
        set lineWidth(value: number) { state.lineWidth = value; },
        get lineCap() { return state.lineCap; },
        set lineCap(value: string) { state.lineCap = value; },
        font: '',
        textAlign: 'left',
        textBaseline: 'middle',
        imageSmoothingEnabled: false,
        measureText: (text: string) => ({ width: text.length * 6 }),
        createImageData: (width: number, height: number) => ({
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4),
        }),
    };

    for (const method of [...RECORDED_METHODS, ...Object.keys(ANSWERS)]) {
        recorder[method] = (...args: unknown[]) => {
            calls.push({ method, args, ...state });
            return ANSWERS[method]?.();
        };
    }

    return {
        context: recorder as unknown as CanvasRenderingContext2D,
        calls,
        callsTo: (method) => calls.filter((call) => call.method === method),
    };
}

export const DEFAULT_VIEWPORT: ChartViewport = {
    fromMs: 1_000_000,
    toMs: 1_900_000,
    lowPrice: 78_000,
    highPrice: 79_000,
};

export interface PaintContextOptions {
    readonly dataset?: Partial<ChartDataset>;
    readonly viewport?: Partial<ChartViewport>;
    readonly pointer?: RenderRequest['pointer'];
    readonly plans?: RenderRequest['plans'];
    /** How much of the grid the frame is ruled with. */
    readonly gridChoice?: RenderRequest['gridChoice'];
    /** Whether unrecorded stretches are marked. */
    readonly areGapsVisible?: boolean;
    readonly crosshairY?: number | null;
    readonly isVolumeProfileVisible?: boolean;
    /** The instant being painted, for what counts down rather than sits still. */
    readonly nowMs?: number;
    /** What each drawn layer is tuned to, for a painter that reads its own. */
    readonly layerSettings?: RenderRequest['layerSettings'];
    readonly cssWidth?: number;
    readonly cssHeight?: number;
    readonly priceTickSpacingPx?: number;
    readonly timeTickSpacingPx?: number;
    /** The marks a reader left, for the painter that draws them. */
    readonly drawings?: RenderRequest['drawings'];
}

/**
 * Builds a paint context around a recording canvas.
 *
 * @param recording - The canvas whose calls the test will assert on.
 * @param options - Anything the test wants to differ from a plain live view.
 * @returns The context painters take.
 */
export function buildPaintContext(
    recording: RecordingContext,
    options: PaintContextOptions = {},
): PaintContext {
    const viewport = { ...DEFAULT_VIEWPORT, ...options.viewport };
    const plans = options.plans ?? [];
    const layout = resolveChartLayout({
        cssWidth: options.cssWidth ?? 1_000,
        cssHeight: options.cssHeight ?? 600,
        isVolumeProfileVisible: options.isVolumeProfileVisible ?? false,
        indicatorPaneCount: countPanedPlans(plans),
    });

    return {
        context: recording.context,
        layout,
        translate: buildTranslate('en'),
        priceTicks: choosePriceTicks({
            viewport,
            extentPx: layout.pricePaneHeight,
            minimumSpacingPx: options.priceTickSpacingPx ?? 64,
        }),
        timeTicks: chooseTimeTicks({
            viewport,
            extentPx: layout.plotWidth,
            minimumSpacingPx: options.timeTickSpacingPx ?? 96,
        }),
        panePlacements: placePanes(plans, layout.indicatorPanes, viewport),
        projector: new ViewportProjector({
            viewport,
            width: layout.plotWidth,
            height: layout.pricePaneHeight,
        }),
        request: {
            viewport,
            dataset: { ...EMPTY_DATASET, priceBucketSize: 10, ...options.dataset },
            nowMs: options.nowMs ?? DEFAULT_VIEWPORT.toMs,
            colourGain: 1,
            isDepthVisible: true,
            isCandleOverlayVisible: true,
            isTradeOverlayVisible: true,
            isVolumeProfileVisible: options.isVolumeProfileVisible ?? false,
            layerSettings: options.layerSettings ?? {},
            pointer: options.pointer ?? null,
            locale: 'en',
            plans,
            theme: 'dark',
            gridChoice: options.gridChoice ?? 'both',
            areGapsVisible: options.areGapsVisible ?? true,
            drawings: options.drawings ?? EMPTY_DRAWINGS_VIEW,
        },
        crosshairY: options.crosshairY ?? options.pointer?.y ?? null,
    };
}
