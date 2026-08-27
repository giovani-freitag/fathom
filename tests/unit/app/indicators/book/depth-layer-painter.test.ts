import { describe, expect, it } from 'vitest';
import { buildPaintContext, createRecordingContext } from '../../../../mocks/canvas-context.ts';
import type { BackgroundPaintRequest } from '../../../../../src/app/painting/render-types.ts';
import { chooseBucketsPerBand } from '../../../../../src/app/indicators/book/depth-layer-painter.ts';

/** A frame drawn over `paneHeight` pixels with a book gridded at `bucketSize`. */
function buildRequest(bucketSize: number, paneHeight = 800): BackgroundPaintRequest {
    const paint = buildPaintContext(createRecordingContext(), {
        dataset: { priceBucketSize: bucketSize },
        cssHeight: paneHeight,
    });
    return { context: paint.context, layout: paint.layout, request: paint.request };
}

/** How many buckets of this book are squeezed into one pixel of that pane. */
function bucketsPerPixel(request: BackgroundPaintRequest): number {
    const { viewport, dataset } = request.request;
    return (viewport.highPrice - viewport.lowPrice)
        / request.layout.pricePaneHeight / dataset.priceBucketSize;
}

describe('chooseBucketsPerBand', () => {
    it('folds nothing while a bucket is already several pixels tall', () => {
        // Close in, folding would throw away the price detail that is the whole
        // point of being close.
        const request = buildRequest(100);

        expect(chooseBucketsPerBand(request)).toBe(1);
    });

    it('folds once a bucket has thinned to a hairline', () => {
        const request = buildRequest(1);

        expect(1 / bucketsPerPixel(request)).toBeLessThan(3);
        expect(chooseBucketsPerBand(request)).toBeGreaterThan(1);
    });

    it('folds enough for a band to be a bar rather than a hairline', () => {
        // A row one or two pixels high reads as scattered specks over a window
        // of days, and the ones that land on a half pixel fainter still.
        const request = buildRequest(1);

        const bandHeightPx = chooseBucketsPerBand(request) / bucketsPerPixel(request);

        expect(bandHeightPx).toBeGreaterThanOrEqual(3);
    });

    it('folds no more than it has to, so a band stays about a price', () => {
        const request = buildRequest(1);

        const bandHeightPx = chooseBucketsPerBand(request) / bucketsPerPixel(request);

        expect(bandHeightPx).toBeLessThan(8);
    });

    it('answers the same thing either side of a small drift in the prices on screen', () => {
        // The price band follows the market, so an answer that moved with it
        // would rebuild the whole field between one frame and the next.
        const answers = [1, 1.02, 1.04].map((size) => chooseBucketsPerBand(buildRequest(size)));

        expect(new Set(answers).size).toBe(1);
    });

    it('stops folding somewhere, however far out the window is pulled', () => {
        expect(chooseBucketsPerBand(buildRequest(0.000_001))).toBeLessThanOrEqual(64);
    });
});
