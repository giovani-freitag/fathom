import type { LiquidityFrame } from '../../../src/book/liquidity-frame.ts';
import type { ChartDataset } from '../../../src/chart/chart-dataset.ts';
import { DepthField } from '../../../src/chart/painting/depth-field.ts';
import { describe, expect, it } from 'vitest';

const PRICE_BUCKET_SIZE = 10;
const MID_PRICE = 79_000;
const TOUCH_BUCKET = MID_PRICE / PRICE_BUCKET_SIZE;

function buildFrame(capturedAtMs: number, midPrice = MID_PRICE): LiquidityFrame {
    const touchBucket = Math.floor(midPrice / PRICE_BUCKET_SIZE);
    return {
        capturedAtMs,
        bestBidPrice: midPrice - 0.5,
        bestAskPrice: midPrice + 0.5,
        bids: { lowestBucketIndex: touchBucket - 160, quantities: new Float32Array(160).fill(3) },
        asks: { lowestBucketIndex: touchBucket, quantities: new Float32Array(160).fill(3) },
    };
}

function buildDataset(frames: LiquidityFrame[]): ChartDataset {
    return {
        instrumentSymbol: 'BTCUSDT',
        priceBucketSize: PRICE_BUCKET_SIZE,
        sampleIntervalMs: 1_000,
        clusterPriceBucketSize: PRICE_BUCKET_SIZE,
        clusterIntervalMs: 1_000,
        frames,
        clusters: [],
        gaps: [],
        saturationQuantity: 300,
        revision: frames.length,
    };
}

describe('DepthField over a long live session', () => {
    it('absorbs a streamed second without rebuilding, for the whole headroom', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1 });

        let absorbed = 0;
        for (let second = 2; second < 560; second += 1) {
            frames.push(buildFrame(second * 1_000));
            if (field.absorb(buildDataset([...frames]), 1)) {
                absorbed += 1;
            }
        }

        expect(absorbed).toBe(558);
    });

    it('asks for a rebuild once the reserved columns run out', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1 });
        for (let second = 2; second < 700; second += 1) {
            frames.push(buildFrame(second * 1_000));
            field.absorb(buildDataset([...frames]), 1);
        }

        frames.push(buildFrame(1_200_000));

        expect(field.absorb(buildDataset([...frames]), 1)).toBe(false);
    });

    it('asks for a rebuild once price walks off the painted band', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1 });

        frames.push(buildFrame(2_000, MID_PRICE * 1.5));

        expect(field.absorb(buildDataset([...frames]), 1)).toBe(false);
    });

    it('builds a full-width window inside a frame budget', () => {
        const frames = Array.from({ length: 2_000 }, (_unused, index) => buildFrame(index * 1_000));
        const started = performance.now();

        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1 });

        expect([field.columnCount, performance.now() - started < 900]).toEqual([2_000, true]);
    });

    it('bounds the image it allocates whatever the price range', () => {
        const frames = Array.from({ length: 400 }, (_unused, index) => buildFrame(
            index * 1_000,
            MID_PRICE + index * 500,
        ));

        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1 });

        expect(field.canvas.width * field.canvas.height).toBeLessThanOrEqual(8_000_000);
    });

    it('keeps the busiest price band when it has to clip', () => {
        const frames = Array.from({ length: 200 }, (_unused, index) => buildFrame(
            index * 1_000,
            index < 190 ? MID_PRICE : MID_PRICE + 900_000,
        ));

        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1 });
        const highestBucket = field.lowestBucketIndex + field.bucketCount - 1;

        expect(TOUCH_BUCKET >= field.lowestBucketIndex && TOUCH_BUCKET <= highestBucket).toBe(true);
    });
});
