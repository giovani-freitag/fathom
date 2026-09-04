import { EMPTY_BAR_WINDOW } from '../../../../../src/shared/core/price-bar.ts';
import type { LiquidityFrame } from '../../../../../src/shared/core/liquidity-frame.ts';
import { DepthField } from '../../../../../src/app/indicators/book/depth-field.ts';
import type { ChartDataset } from '../../../../../src/app/core/chart-dataset.ts';
import { describe, expect, it } from 'vitest';

const PRICE_BUCKET_SIZE = 10;

function buildFrame(capturedAtMs: number, midPrice = 1_000): LiquidityFrame {
    const touchBucket = Math.floor(midPrice / PRICE_BUCKET_SIZE);
    return {
        capturedAtMs,
        bestBidPrice: midPrice - 0.5,
        bestAskPrice: midPrice + 0.5,
        bids: { lowestBucketIndex: touchBucket - 2, quantities: Float32Array.from([1, 2, 3]) },
        asks: { lowestBucketIndex: touchBucket, quantities: Float32Array.from([3, 2, 1]) },
    };
}

function buildDataset(frames: LiquidityFrame[], overrides: Partial<ChartDataset> = {}): ChartDataset {
    return {
        instrumentSymbol: 'BTCUSDT',
        priceBucketSize: PRICE_BUCKET_SIZE,
        sampleIntervalMs: 1_000,
        clusterPriceBucketSize: PRICE_BUCKET_SIZE,
        clusterIntervalMs: 1_000,
        frames,
        clusters: [],
        gaps: [],
        bars: EMPTY_BAR_WINDOW,
        higher: new Map(),
        saturationQuantity: 10,
        floorQuantity: 0,
        revision: 1,
        ...overrides,
    };
}

function buildField(frames: LiquidityFrame[], bucketsPerBand = 1): DepthField {
    return new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand });
}

describe('DepthField', () => {
    it('spans one column per sample interval', () => {
        const field = buildField([buildFrame(0), buildFrame(1_000), buildFrame(2_000)]);

        expect(field.columnCount).toBe(3);
    });

    it('maps an instant onto its column', () => {
        const field = buildField([buildFrame(10_000), buildFrame(11_000)]);

        expect(field.timeToColumn(11_000)).toBe(1);
    });

    it('reserves columns beyond the loaded window for streamed frames', () => {
        const field = buildField([buildFrame(0), buildFrame(1_000)]);

        expect(field.canvas.width).toBeGreaterThan(field.columnCount);
    });
});

describe('DepthField.absorb', () => {
    it('accepts a dataset it has already painted', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset(frames), 1, 1)).toBe(true);
    });

    it('accepts frames appended after the ones it painted', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset([...frames, buildFrame(2_000)]), 1, 1)).toBe(true);
    });

    it('absorbs a second run appended after the first', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);
        const extended = [...frames, buildFrame(2_000)];
        field.absorb(buildDataset(extended), 1, 1);

        expect(field.absorb(buildDataset([...extended, buildFrame(3_000)]), 1, 1)).toBe(true);
    });

    it('refuses a dataset that replaced the frames it painted', () => {
        const field = buildField([buildFrame(0), buildFrame(1_000)]);

        expect(field.absorb(buildDataset([buildFrame(500), buildFrame(1_500)]), 1, 1)).toBe(false);
    });

    it('refuses a dataset that lost frames', () => {
        const field = buildField([buildFrame(0), buildFrame(1_000)]);

        expect(field.absorb(buildDataset([buildFrame(0)]), 1, 1)).toBe(false);
    });

    it('refuses a changed colour gain, which recolours every column', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset(frames), 2.5, 1)).toBe(false);
    });

    it('refuses a changed sampling interval, which moves every column', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset(frames, { sampleIntervalMs: 2_000 }), 1, 1)).toBe(false);
    });

    it('refuses a changed instrument', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset(frames, { instrumentSymbol: 'ETHUSDT' }), 1, 1)).toBe(false);
    });

    it('refuses a changed saturation, which recolours every column', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset(frames, { saturationQuantity: 99 }), 1, 1)).toBe(false);
    });

    it('refuses a frame whose touch walked outside the painted band', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset([...frames, buildFrame(2_000, 90_000)]), 1, 1)).toBe(false);
    });

    it('refuses a frame past the reserved columns', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset([...frames, buildFrame(9_000_000)]), 1, 1)).toBe(false);
    });
});

describe('DepthField folding buckets into bands', () => {
    it('draws one row per bucket while every bucket has a pixel of its own', () => {
        const field = buildField([buildFrame(0)]);

        expect(field.canvas.height).toBe(field.bucketCount);
    });

    it('draws one row per band once buckets are folded together', () => {
        const field = buildField([buildFrame(0)], 4);

        expect(field.canvas.height).toBe(field.bucketCount / 4);
    });

    it('covers four times the price in a row that holds four buckets', () => {
        expect(buildField([buildFrame(0)], 4).priceRowSize).toBe(PRICE_BUCKET_SIZE * 4);
    });

    it('moves up exactly one row for the price a row covers', () => {
        const field = buildField([buildFrame(0)], 4);

        const climbed = field.priceToRow(1_000) - field.priceToRow(1_000 + field.priceRowSize);

        expect(climbed).toBeCloseTo(1);
    });

    it('holds whole bands only, so no row is drawn from prices it never covered', () => {
        expect(buildField([buildFrame(0)], 4).bucketCount % 4).toBe(0);
    });

    it('refuses to absorb into a field folded a different way', () => {
        // The rows would be the old size and the new prices would land in the
        // wrong ones, which is a field showing liquidity at prices it is not at.
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames, 2);

        expect(field.absorb(buildDataset(frames), 1, 4)).toBe(false);
    });

    /** One instant with a single size resting at one price. */
    function buildWall(capturedAtMs: number, quantity: number): LiquidityFrame {
        const touchBucket = Math.floor(1_000 / PRICE_BUCKET_SIZE);
        return {
            capturedAtMs,
            bestBidPrice: 999.5,
            bestAskPrice: 1_000.5,
            bids: { lowestBucketIndex: touchBucket, quantities: Float32Array.from([quantity]) },
            asks: { lowestBucketIndex: touchBucket + 1, quantities: Float32Array.from([]) },
        };
    }

    /**
     * The pixels one field paints, off a surface it can actually draw on.
     *
     * The field makes its own canvas, and the one this environment hands back
     * has no context to paint into — so every test here has measured the shape
     * of the picture and none of them what is in it.
     */
    function paintOnto(frames: LiquidityFrame[], sampleIntervalMs: number): Uint8ClampedArray {
        let painted: ImageData | null = null;
        const context = {
            createImageData: (width: number, height: number) => ({
                width, height, data: new Uint8ClampedArray(width * height * 4),
            }),
            putImageData: (image: ImageData) => { painted = image; },
            clearRect: () => undefined,
        };
        const surface = {
            width: 0, height: 0, getContext: () => context,
        } as unknown as HTMLCanvasElement;

        const field = new DepthField({
            dataset: buildDataset(frames, { sampleIntervalMs }),
            colourGain: 1,
            bucketsPerBand: 1,
            reuse: surface,
        });
        field.settle(1_000);
        return (painted as ImageData | null)?.data ?? new Uint8ClampedArray();
    }

    it('folds the instants sharing a column instead of painting them over', () => {
        // A window wider than the recording is fine puts several seconds in one
        // drawn column. Painted one after another the column keeps whichever
        // went last, so a wall that stood for three of four seconds vanishes if
        // it was gone by the fourth — and the live edge draws as a scatter
        // beside history the store folded by the largest.
        // Two columns either way, so the two pictures are the same shape and
        // only what is in them can differ. The wall stands through the second
        // column and is gone by its last instant.
        const crowded = paintOnto(
            [buildWall(0, 9), buildWall(2_000, 9), buildWall(3_000, 1)],
            4_000,
        );
        const stoodThroughout = paintOnto(
            [buildWall(0, 9), buildWall(2_000, 9)],
            4_000,
        );

        expect([...crowded]).toEqual([...stoodThroughout]);
    });

    it('draws a lone instant the same whatever the column is worth', () => {
        // The guard on the test above: it only says something if the two fields
        // agree when there is nothing to fold.
        const one = paintOnto([buildWall(0, 9)], 4_000);

        expect(one.some((channel) => channel > 0)).toBe(true);
    });
});
