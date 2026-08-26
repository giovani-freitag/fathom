import { EMPTY_BAR_WINDOW } from '../../../../src/shared/core/price-bar.ts';
import type { LiquidityFrame } from '../../../../src/shared/core/liquidity-frame.ts';
import { DepthField } from '../../../../src/app/painting/depth-field.ts';
import type { ChartDataset } from '../../../../src/app/core/chart-dataset.ts';
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
        saturationQuantity: 10,
        floorQuantity: 0,
        revision: 1,
        ...overrides,
    };
}

function buildField(frames: LiquidityFrame[]): DepthField {
    return new DepthField({ dataset: buildDataset(frames), colourGain: 1 });
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

        expect(field.absorb(buildDataset(frames), 1)).toBe(true);
    });

    it('accepts frames appended after the ones it painted', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset([...frames, buildFrame(2_000)]), 1)).toBe(true);
    });

    it('absorbs a second run appended after the first', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);
        const extended = [...frames, buildFrame(2_000)];
        field.absorb(buildDataset(extended), 1);

        expect(field.absorb(buildDataset([...extended, buildFrame(3_000)]), 1)).toBe(true);
    });

    it('refuses a dataset that replaced the frames it painted', () => {
        const field = buildField([buildFrame(0), buildFrame(1_000)]);

        expect(field.absorb(buildDataset([buildFrame(500), buildFrame(1_500)]), 1)).toBe(false);
    });

    it('refuses a dataset that lost frames', () => {
        const field = buildField([buildFrame(0), buildFrame(1_000)]);

        expect(field.absorb(buildDataset([buildFrame(0)]), 1)).toBe(false);
    });

    it('refuses a changed colour gain, which recolours every column', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset(frames), 2.5)).toBe(false);
    });

    it('refuses a changed sampling interval, which moves every column', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset(frames, { sampleIntervalMs: 2_000 }), 1)).toBe(false);
    });

    it('refuses a changed instrument', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset(frames, { instrumentSymbol: 'ETHUSDT' }), 1)).toBe(false);
    });

    it('refuses a changed saturation, which recolours every column', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset(frames, { saturationQuantity: 99 }), 1)).toBe(false);
    });

    it('refuses a frame whose touch walked outside the painted band', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset([...frames, buildFrame(2_000, 90_000)]), 1)).toBe(false);
    });

    it('refuses a frame past the reserved columns', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = buildField(frames);

        expect(field.absorb(buildDataset([...frames, buildFrame(9_000_000)]), 1)).toBe(false);
    });
});
