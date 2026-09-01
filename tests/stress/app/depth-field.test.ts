import { EMPTY_BAR_WINDOW } from '../../../src/shared/core/price-bar.ts';
import type { LiquidityFrame } from '../../../src/shared/core/liquidity-frame.ts';
import type { ChartDataset } from '../../../src/app/core/chart-dataset.ts';
import { DepthField } from '../../../src/app/indicators/book/depth-field.ts';
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

function buildDataset(frames: LiquidityFrame[], sampleIntervalMs = 1_000): ChartDataset {
    return {
        instrumentSymbol: 'BTCUSDT',
        priceBucketSize: PRICE_BUCKET_SIZE,
        sampleIntervalMs,
        clusterPriceBucketSize: PRICE_BUCKET_SIZE,
        clusterIntervalMs: 1_000,
        frames,
        clusters: [],
        gaps: [],
        bars: EMPTY_BAR_WINDOW,
        saturationQuantity: 300,
        floorQuantity: 0,
        revision: frames.length,
    };
}

/** How many instants the field has painted so far. */
function painted(field: DepthField): number {
    return field.paintedRange.to - field.paintedRange.from;
}

/** One instant of a book seen from below it: every price is a bid. */
function buildFrameBelowTheTouch(capturedAtMs: number): LiquidityFrame {
    return {
        capturedAtMs,
        bestBidPrice: MID_PRICE,
        bestAskPrice: MID_PRICE + 1,
        // Far below the touch, so the reader is looking at a stretch the price
        // has not been near: the whole window is on one side of it.
        bids: { lowestBucketIndex: 7_300, quantities: new Float32Array(110).fill(3) },
        asks: { lowestBucketIndex: 0, quantities: new Float32Array(0) },
    };
}

/** One instant of a book seen from above it: every price is an ask. */
function buildFrameAboveTheTouch(capturedAtMs: number): LiquidityFrame {
    return {
        capturedAtMs,
        bestBidPrice: MID_PRICE,
        bestAskPrice: MID_PRICE + 1,
        bids: { lowestBucketIndex: 0, quantities: new Float32Array(0) },
        asks: { lowestBucketIndex: 8_300, quantities: new Float32Array(110).fill(3) },
    };
}

describe('a window read below the price', () => {
    it('covers the prices it holds rather than collapsing to one row', () => {
        // A side with nothing in it reports starting at bucket nought and
        // reaching to one before it. Taken as the top of the book, that leaves
        // the field one row tall at a price nobody is looking at, and the whole
        // layer draws as black over a stretch the archive holds in full.
        const frames = Array.from({ length: 40 }, (_unused, index) => (
            buildFrameBelowTheTouch(index * 1_000)
        ));

        const field = new DepthField({
            dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1,
        });

        expect(field.bucketCount).toBeGreaterThanOrEqual(110);
    });

    it('addresses those prices, so the rows it draws are the ones asked for', () => {
        const frames = Array.from({ length: 40 }, (_unused, index) => (
            buildFrameBelowTheTouch(index * 1_000)
        ));

        const field = new DepthField({
            dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1,
        });

        // A price inside the band has to land inside the image.
        const row = field.priceToRow(73_500);
        expect([row >= 0, row <= field.bucketCount]).toEqual([true, true]);
    });
});

describe('a window read above the price', () => {
    it('covers the prices it holds rather than a band starting at nothing', () => {
        // The mirror of the one below, and it fails differently: an empty bid
        // side reports starting at bucket nought, so the field is asked for
        // every price from nothing up to the book. Too tall to allocate, it is
        // cut back to a band centred on where the price has been — which is not
        // where the reader is looking, and the layer draws as black.
        const frames = Array.from({ length: 40 }, (_unused, index) => (
            buildFrameAboveTheTouch(index * 1_000)
        ));

        const field = new DepthField({
            dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1,
        });

        expect(field.lowestBucketIndex).toBeGreaterThanOrEqual(8_000);
    });

    it('addresses those prices, so the rows it draws are the ones asked for', () => {
        const frames = Array.from({ length: 40 }, (_unused, index) => (
            buildFrameAboveTheTouch(index * 1_000)
        ));

        const field = new DepthField({
            dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1,
        });

        const row = field.priceToRow(83_500);
        expect([row >= 0, row <= field.bucketCount]).toEqual([true, true]);
    });
});

describe('DepthField over a long live session', () => {
    it('absorbs a streamed second without rebuilding, for the whole headroom', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });

        let absorbed = 0;
        for (let second = 2; second < 560; second += 1) {
            frames.push(buildFrame(second * 1_000));
            if (field.absorb(buildDataset([...frames]), 1, 1)) {
                absorbed += 1;
            }
        }

        expect(absorbed).toBe(558);
    });

    it('asks for a rebuild once the reserved columns run out', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });
        for (let second = 2; second < 700; second += 1) {
            frames.push(buildFrame(second * 1_000));
            field.absorb(buildDataset([...frames]), 1, 1);
        }

        frames.push(buildFrame(1_200_000));

        expect(field.absorb(buildDataset([...frames]), 1, 1)).toBe(false);
    });

    it('asks for a rebuild once price walks off the painted band', () => {
        const frames = [buildFrame(0), buildFrame(1_000)];
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });

        frames.push(buildFrame(2_000, MID_PRICE * 1.5));

        expect(field.absorb(buildDataset([...frames]), 1, 1)).toBe(false);
    });

    it('takes on a full-width window without painting any of it', () => {
        // The candles, the axes and the cursor are drawn on this same thread.
        // Measured on a four hour window, folding and colouring all of it at
        // once held that thread for about three hundred milliseconds a rebuild,
        // three times over a single change of range.
        const frames = Array.from({ length: 4_000 }, (_unused, index) => buildFrame(index * 1_000));
        const started = performance.now();

        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });

        expect([field.columnCount, performance.now() - started < 20]).toEqual([4_000, true]);
    });

    it('holds the thread for no longer than the share it was given', () => {
        const frames = Array.from({ length: 4_000 }, (_unused, index) => buildFrame(index * 1_000));
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });

        const started = performance.now();
        field.settle(6);

        expect(performance.now() - started).toBeLessThan(60);
    });

    it('stops at the end of a slice when its share is already spent', () => {
        const frames = Array.from({ length: 4_000 }, (_unused, index) => buildFrame(index * 1_000));
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });

        const isSettled = field.settle(0);

        expect([isSettled, painted(field) > 0, painted(field) < 4_000])
            .toEqual([false, true, true]);
    });

    it('never stops a slice inside a drawn column', () => {
        // A slice is written to the image whole, replacing the columns it
        // covers. Two slices sharing a column would leave only the rows the
        // later one put there, and the wall the earlier instants stood at is
        // rubbed out on one column of every slice.
        const frames = Array.from({ length: 4_000 }, (_unused, index) => buildFrame(index * 1_000));
        const field = new DepthField({
            dataset: buildDataset(frames, 4_000), colourGain: 1, bucketsPerBand: 1,
        });

        const stops: number[] = [];
        while (!field.settle(0)) {
            stops.push(painted(field));
        }

        // Four instants to a drawn column: a slice may only end where the next
        // instant opens one.
        const columnOf = (index: number) => Math.round(index * 1_000 / 4_000);
        expect(stops.filter((at) => columnOf(at) === columnOf(at - 1))).toEqual([]);
    });

    it('paints what the reader is looking at before what they are not', () => {
        // The window loaded reaches well past the view on both sides so a short
        // pan needs no round trip. Painted in order, the first half of the work
        // goes on instants nobody is looking at, and the reader watches the old
        // picture for all of it.
        const frames = Array.from({ length: 4_000 }, (_unused, index) => buildFrame(index * 1_000));
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });

        // Looking at the far end of the window, which nothing would reach until
        // the very last pass if the painting simply ran forward.
        field.settle(0, 3_000 * 1_000);
        const afterOne = painted(field);
        field.settle(0);

        expect([afterOne > 0, painted(field) > afterOne, painted(field) < 4_000])
            .toEqual([true, true, true]);
    });

    it('starts where the reader is looking, not at the oldest instant it holds', () => {
        const frames = Array.from({ length: 4_000 }, (_unused, index) => buildFrame(index * 1_000));
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });

        field.settle(0, 3_000 * 1_000);

        expect(field.paintedRange.from).toBeGreaterThan(2_900);
    });

    it('paints every instant it holds, however many passes that takes', () => {
        // A slice at a time is only worth anything if the picture still ends up
        // whole: a budget that dropped what it could not reach would leave the
        // book blank wherever the pass happened to stop.
        const frames = Array.from({ length: 4_000 }, (_unused, index) => buildFrame(index * 1_000));
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });

        let passes = 0;
        while (!field.settle(0) && passes < 10_000) {
            passes += 1;
        }

        expect([passes > 0, painted(field)]).toEqual([true, 4_000]);
    });

    it('carries on painting a window that grew while it was still filling', () => {
        // A tail delivers seconds while the field is still catching up on the
        // window behind them. Taken on and then forgotten, the live edge would
        // be the one stretch the book never draws.
        const frames = Array.from({ length: 400 }, (_unused, index) => buildFrame(index * 1_000));
        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });
        field.settle(0);

        const grown = [...frames, buildFrame(400_000), buildFrame(401_000)];
        const wasAdopted = field.absorb(buildDataset(grown), 1, 1);
        while (!field.settle(0)) {
            // Filled to the end.
        }

        expect([wasAdopted, painted(field)]).toEqual([true, 402]);
    });

    it('bounds the image it allocates whatever the price range', () => {
        const frames = Array.from({ length: 400 }, (_unused, index) => buildFrame(
            index * 1_000,
            MID_PRICE + index * 500,
        ));

        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });

        expect(field.canvas.width * field.canvas.height).toBeLessThanOrEqual(8_000_000);
    });

    it('keeps the busiest price band when it has to clip', () => {
        const frames = Array.from({ length: 200 }, (_unused, index) => buildFrame(
            index * 1_000,
            index < 190 ? MID_PRICE : MID_PRICE + 900_000,
        ));

        const field = new DepthField({ dataset: buildDataset(frames), colourGain: 1, bucketsPerBand: 1 });
        const highestBucket = field.lowestBucketIndex + field.bucketCount - 1;

        expect(TOUCH_BUCKET >= field.lowestBucketIndex && TOUCH_BUCKET <= highestBucket).toBe(true);
    });
});
