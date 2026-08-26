import { DepthField } from './depth-field.ts';
import type {
    BackgroundPaintRequest,
    FieldBackgroundPainter,
    RenderRequest,
} from '../../painting/render-types.ts';

/**
 * Blits the pre-rendered depth field into the plot.
 *
 * It holds the field between frames, because a streamed second changes one
 * column and rebuilding the window for it costs tens of milliseconds twice a
 * second — felt as stutter on a phone long before it is on a desktop.
 */
export class DepthLayerPainter implements FieldBackgroundPainter {
    private cachedField: DepthField | null = null;

    /**
     * Draws the visible slice of the field across the plot.
     *
     * @param request - The context, layout, and what the frame is drawn from.
     */
    paintBackground(request: BackgroundPaintRequest): void {
        const field = this.resolveField(request.request);
        if (field === null) {
            return;
        }

        const { context, layout } = request;
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
        context.imageSmoothingEnabled = sourceHeight > layout.pricePaneHeight;
        context.drawImage(
            field.canvas,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            layout.plotWidth,
            layout.pricePaneHeight,
        );
    }

    /**
     * Releases the field it was holding.
     */
    dispose(): void {
        this.cachedField = null;
    }

    /**
     * The field for this frame, absorbing a streamed second where it can.
     */
    private resolveField(request: RenderRequest): DepthField | null {
        if (!request.isDepthVisible || request.dataset.frames.length === 0) {
            return null;
        }

        const cached = this.cachedField;
        if (cached !== null && cached.absorb(request.dataset, request.colourGain)) {
            return cached;
        }

        const field = new DepthField({ dataset: request.dataset, colourGain: request.colourGain });
        this.cachedField = field;
        return field;
    }
}
