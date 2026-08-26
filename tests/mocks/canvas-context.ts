import { buildTranslate } from '../../src/app/i18n/translator.ts';
import type { ChartViewport } from '../../src/app/core/chart-viewport.ts';
import { choosePriceTicks, chooseTimeTicks } from '../../src/app/painting/axis-ticks.ts';
import { ViewportProjector } from '../../src/app/core/viewport-projector.ts';
import type { ChartDataset } from '../../src/app/core/chart-dataset.ts';
import { EMPTY_DATASET } from '../../src/app/core/chart-dataset.ts';
import { resolveChartLayout } from '../../src/app/painting/chart-layout.ts';
import { isPriceScale, placePanes } from '../../src/app/painting/pane-projector.ts';
import type { PaintContext, RenderRequest } from '../../src/app/painting/render-types.ts';

export interface RecordedCall {
    readonly method: string;
    readonly args: readonly unknown[];
    /** Fill and stroke styles in force when the call was made. */
    readonly fillStyle: string;
    readonly strokeStyle: string;
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

/**
 * A 2D context that records what was asked of it.
 *
 * Painters are pure in everything but their draw calls, so recording those is
 * the whole assertion surface — and it works in jsdom, which has no real canvas.
 */
export function createRecordingContext(): RecordingContext {
    const calls: RecordedCall[] = [];
    const state = { fillStyle: '', strokeStyle: '' };

    const recorder: Record<string, unknown> = {
        get fillStyle() { return state.fillStyle; },
        set fillStyle(value: string) { state.fillStyle = value; },
        get strokeStyle() { return state.strokeStyle; },
        set strokeStyle(value: string) { state.strokeStyle = value; },
        lineWidth: 1,
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

    for (const method of RECORDED_METHODS) {
        recorder[method] = (...args: unknown[]) => {
            calls.push({ method, args, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle });
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
    readonly crosshairY?: number | null;
    readonly isVolumeProfileVisible?: boolean;
    readonly cssWidth?: number;
    readonly cssHeight?: number;
    readonly priceTickSpacingPx?: number;
    readonly timeTickSpacingPx?: number;
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
        indicatorPaneCount: plans.filter((plan) => !isPriceScale(plan.scale)).length,
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
        panePlacements: placePanes(plans, layout.indicatorPanes),
        projector: new ViewportProjector({
            viewport,
            width: layout.plotWidth,
            height: layout.pricePaneHeight,
        }),
        request: {
            viewport,
            dataset: { ...EMPTY_DATASET, priceBucketSize: 10, ...options.dataset },
            colourGain: 1,
            isCandleOverlayVisible: true,
            isTradeOverlayVisible: true,
            isVolumeProfileVisible: options.isVolumeProfileVisible ?? false,
            pointer: options.pointer ?? null,
            locale: 'en',
            plans,
            theme: 'dark',
        },
        crosshairY: options.crosshairY ?? options.pointer?.y ?? null,
    };
}
