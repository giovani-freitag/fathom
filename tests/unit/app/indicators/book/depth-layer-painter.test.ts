import { describe, expect, it } from 'vitest';
import { buildPaintContext, createRecordingContext } from '../../../../mocks/canvas-context.ts';
import type { BackgroundPaintRequest } from '../../../../../src/app/painting/render-types.ts';
import {
    chooseBucketsPerBand,
    DepthLayerPainter,
} from '../../../../../src/app/indicators/book/depth-layer-painter.ts';
import type { LiquidityFrame } from '../../../../../src/shared/core/liquidity-frame.ts';

/** A frame drawn over `paneHeight` pixels with a book gridded at `bucketSize`. */
function buildRequest(bucketSize: number, paneHeight = 800): BackgroundPaintRequest {
    const paint = buildPaintContext(createRecordingContext(), {
        dataset: { priceBucketSize: bucketSize },
        cssHeight: paneHeight,
    });
    return { context: paint.context, layout: paint.layout, request: paint.request, budgetMs: 6 };
}

/** How many buckets of this book are squeezed into one pixel of that pane. */
function bucketsPerPixel(request: BackgroundPaintRequest): number {
    const { viewport, dataset } = request.request;
    return (viewport.highPrice - viewport.lowPrice)
        / request.layout.pricePaneHeight / dataset.priceBucketSize;
}

/** Where the viewport the paint context builds starts, in milliseconds. */
const VIEWPORT_FROM_MS = 1_000_000;

/** A book with every price on one side of the touch, as a reader off it sees. */
function buildOneSidedFrames(side: 'bids' | 'asks', lowestBucketIndex: number): LiquidityFrame[] {
    return Array.from({ length: 60 }, (_unused, index) => ({
        capturedAtMs: VIEWPORT_FROM_MS + index * 1_000,
        bestBidPrice: 79_000,
        bestAskPrice: 79_001,
        bids: side === 'bids'
            ? { lowestBucketIndex, quantities: new Float32Array(120).fill(4) }
            : { lowestBucketIndex: 0, quantities: new Float32Array(0) },
        asks: side === 'asks'
            ? { lowestBucketIndex, quantities: new Float32Array(120).fill(4) }
            : { lowestBucketIndex: 0, quantities: new Float32Array(0) },
    }));
}

describe('DepthLayerPainter over prices the market is not at', () => {
    /** Paints one frame and reports the source rectangle it blitted from. */
    function paintOver(side: 'bids' | 'asks', lowestBucketIndex: number, lowPrice: number) {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: {
                priceBucketSize: 10,
                sampleIntervalMs: 1_000,
                frames: buildOneSidedFrames(side, lowestBucketIndex),
            },
            viewport: { lowPrice, highPrice: lowPrice + 600 },
        });
        const painter = new DepthLayerPainter();
        painter.paintBackground({
            context: paint.context, layout: paint.layout, request: paint.request, budgetMs: 50,
        });
        const blit = recording.calls.filter((call) => call.method === 'drawImage').at(-1);
        return blit === undefined
            ? null
            : { sourceY: blit.args[2] as number, sourceHeight: blit.args[4] as number };
    }

    it('blits a slice of the field when the reader is below the market', () => {
        // The whole reason this layer went black: a side with nothing in it
        // reports starting at bucket nought and reaching to one before it, so
        // the field ended up one row tall at a price nobody was looking at and
        // the blit fell outside it entirely.
        const blit = paintOver('bids', 7_300, 73_100);

        expect(blit !== null && blit.sourceY >= 0 && blit.sourceHeight > 0).toBe(true);
    });

    // The mirror of this — a reader above the market — fails differently and is
    // caught where it shows: the field there is not blank but enormous, sized
    // from bucket nought up to the book, and only the field knows its own size.
});

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
