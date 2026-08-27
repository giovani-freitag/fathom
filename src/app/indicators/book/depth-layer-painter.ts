import { DepthField } from './depth-field.ts';
import type {
    BackgroundPaintRequest,
    FieldBackgroundPainter,
    RenderRequest,
} from '../../painting/render-types.ts';

/**
 * How tall a drawn band is, at least.
 *
 * A row one or two pixels high is a hairline: over a window of days it reads as
 * scattered specks rather than as the walls price kept turning at, and the ones
 * that land on a half pixel come out fainter still. Three is enough for a bar a
 * reader can follow across the window without folding so far that the reading
 * stops being about a price.
 */
const MINIMUM_BAND_HEIGHT_PX = 3;

/**
 * The most buckets one band may hold.
 *
 * Past this the reading stops being about a price and starts being about a
 * neighbourhood, which is not what the chart is for.
 */
const MAXIMUM_BUCKETS_PER_BAND = 64;

/**
 * How many price buckets to fold into one drawn row.
 *
 * Quantised to powers of two so that a pinch, which changes the price on screen
 * continuously, does not rebuild the whole field on every frame of the gesture.
 *
 * @param request - The frame being drawn, for the prices on screen and the room.
 * @returns Buckets per band, one when every bucket already has a pixel.
 */
export function chooseBucketsPerBand(request: BackgroundPaintRequest): number {
    const { viewport, dataset } = request.request;
    const pricePerPixel = (viewport.highPrice - viewport.lowPrice)
        / Math.max(1, request.layout.pricePaneHeight);
    const bucketsPerPixel = pricePerPixel / Math.max(Number.EPSILON, dataset.priceBucketSize);
    const wanted = bucketsPerPixel * MINIMUM_BAND_HEIGHT_PX;
    if (!Number.isFinite(wanted) || wanted <= 1) {
        // Close in, a bucket is already several pixels tall and folding would
        // throw away the price detail that is the whole point of being close.
        return 1;
    }

    return Math.min(2 ** Math.ceil(Math.log2(wanted)), MAXIMUM_BUCKETS_PER_BAND);
}

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
        const field = this.resolveField(request);
        if (field === null) {
            return;
        }

        const { context, layout } = request;
        const { viewport } = request.request;

        const sourceX = field.timeToColumn(viewport.fromMs);
        const sourceWidth = (viewport.toMs - viewport.fromMs) / field.sampleIntervalMs;
        const sourceY = field.priceToRow(viewport.highPrice);
        const sourceHeight = (viewport.highPrice - viewport.lowPrice) / field.priceRowSize;

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
    private resolveField(paint: BackgroundPaintRequest): DepthField | null {
        const request: RenderRequest = paint.request;
        if (!request.isDepthVisible || request.dataset.frames.length === 0) {
            return null;
        }

        const bucketsPerBand = chooseBucketsPerBand(paint);
        const cached = this.cachedField;
        if (cached !== null && cached.absorb(request.dataset, request.colourGain, bucketsPerBand)) {
            return cached;
        }

        const field = new DepthField({
            dataset: request.dataset,
            colourGain: request.colourGain,
            bucketsPerBand,
        });
        this.cachedField = field;
        return field;
    }
}
