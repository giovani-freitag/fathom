import { describe, expect, it } from 'vitest';
import {
    decodeLiquidityFrameWindow,
    encodeLiquidityFrameWindow,
    measureEncodedByteLength,
} from '../../../src/book/heatmap-codec.ts';
import type { LiquidityFrame, LiquidityFrameWindow } from '../../../src/book/liquidity-frame.ts';

/** A window the widest desktop can ask for: one column per pixel, full depth. */
const FRAME_COUNT = 2_000;
const BUCKETS_PER_SIDE = 160;

function buildLargeWindow(): LiquidityFrameWindow {
    const frames: LiquidityFrame[] = [];
    for (let index = 0; index < FRAME_COUNT; index += 1) {
        const bids = new Float32Array(BUCKETS_PER_SIDE);
        const asks = new Float32Array(BUCKETS_PER_SIDE);
        for (let offset = 0; offset < BUCKETS_PER_SIDE; offset += 1) {
            bids[offset] = (offset * 7 + index) % 400;
            asks[offset] = (offset * 11 + index) % 400;
        }
        frames.push({
            capturedAtMs: 1_700_000_000_000 + index * 1_000,
            bestBidPrice: 78_900 + (index % 50),
            bestAskPrice: 78_900.1 + (index % 50),
            bids: { lowestBucketIndex: 7_800 + (index % 5), quantities: bids },
            asks: { lowestBucketIndex: 7_890 + (index % 5), quantities: asks },
        });
    }
    return { priceBucketSize: 10, sampleIntervalMs: 1_000, frames };
}

describe('heatmap codec under a full-width window', () => {
    const window = buildLargeWindow();

    it('stays inside a few megabytes', () => {
        expect(measureEncodedByteLength(window)).toBeLessThan(3_000_000);
    });

    it('encodes in well under a frame budget', () => {
        const started = performance.now();

        encodeLiquidityFrameWindow(window);

        expect(performance.now() - started).toBeLessThan(400);
    });

    it('decodes in well under a frame budget', () => {
        const encoded = encodeLiquidityFrameWindow(window);
        const started = performance.now();

        decodeLiquidityFrameWindow(encoded);

        expect(performance.now() - started).toBeLessThan(400);
    });

    it('round-trips every quantity of every frame', () => {
        const decoded = decodeLiquidityFrameWindow(encodeLiquidityFrameWindow(window));

        const lastSource = window.frames[FRAME_COUNT - 1]!;
        const lastDecoded = decoded.frames[FRAME_COUNT - 1]!;
        expect([...lastDecoded.asks.quantities]).toEqual([...lastSource.asks.quantities]);
    });

    it('decodes without copying the depth out of the payload', () => {
        const encoded = encodeLiquidityFrameWindow(window);

        const decoded = decodeLiquidityFrameWindow(encoded);

        expect(decoded.frames[500]?.bids.quantities.buffer).toBe(encoded);
    });
});
