import type { DepthField } from '../depth-field.ts';
import type { ChartLayout, RenderRequest } from '../render-types.ts';

export interface DepthLayerRequest {
    readonly context: CanvasRenderingContext2D;
    readonly layout: ChartLayout;
    readonly request: RenderRequest;
    readonly field: DepthField;
}

/**
 * Blits the pre-rendered depth field into the plot.
 */
export class DepthLayerPainter {
    /**
     * Draws the visible slice of the field across the plot.
     *
     * @param request - The context, layout, viewport, and the field to sample.
     */
    paint(request: DepthLayerRequest): void {
        const { context, layout, field } = request;
        const { viewport } = request.request;

        const sourceX = field.timeToColumn(viewport.fromMs);
        const sourceWidth = (viewport.toMs - viewport.fromMs) / field.sampleIntervalMs;
        const sourceY = field.priceToRow(viewport.highPrice);
        const sourceHeight = (viewport.highPrice - viewport.lowPrice) / field.priceBucketSize;

        if (sourceWidth <= 0 || sourceHeight <= 0) {
            return;
        }

        // Averaging only helps when buckets are being squeezed below one pixel;
        // when they are larger than a pixel, smoothing blurs the very edges that
        // make a resting wall readable.
        context.imageSmoothingEnabled = sourceHeight > layout.plotHeight;
        context.drawImage(
            field.canvas,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            layout.plotWidth,
            layout.plotHeight,
        );
    }
}
