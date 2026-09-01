import { describe, expect, it, vi } from 'vitest';
import type { LiquidityQueryService } from '../../../src/database/services/liquidity-query-service.ts';
import { PostgresLiveTailSource } from '../../../src/server/services/postgres-live-tail-source.ts';

const BUCKET_SIZE = 10;
const TOUCH_BUCKET = 7_900;

/** One instant holding far more prices than any chart draws at once. */
function buildWideFrame() {
    const quantities = new Float32Array(2_000).fill(3);
    return {
        capturedAtMs: 1_700_000_000_000,
        bestBidPrice: TOUCH_BUCKET * BUCKET_SIZE,
        bestAskPrice: (TOUCH_BUCKET + 1) * BUCKET_SIZE,
        bids: { lowestBucketIndex: TOUCH_BUCKET - 1_999, quantities },
        asks: { lowestBucketIndex: TOUCH_BUCKET + 1, quantities },
    };
}

function buildSource() {
    const fetchFramesAfter = vi.fn().mockResolvedValue({
        priceBucketSize: BUCKET_SIZE,
        sampleIntervalMs: 1_000,
        frames: [buildWideFrame()],
    });
    const query = { fetchFramesAfter } as unknown as LiquidityQueryService;
    return { fetchFramesAfter, source: new PostgresLiveTailSource({ query }) };
}

/** How many prices one instant carries, both sides counted. */
function priceCount(frame: { bids: { quantities: Float32Array }; asks: { quantities: Float32Array } }): number {
    return frame.bids.quantities.length + frame.asks.quantities.length;
}

describe('PostgresLiveTailSource', () => {
    it('carries only the prices the reader is drawing', async () => {
        // The recording holds four thousand prices around the touch and a chart
        // draws about sixty. Measured on the live gateway, the tail was sending
        // sixty-two kilobytes a second for a picture with room for a four
        // hundredth of it.
        const { source } = buildSource();

        const window = await source.fetchFramesAfter({
            symbol: 'BTCUSDT', afterMs: 0, maxFrames: 60,
            lowPrice: (TOUCH_BUCKET - 30) * BUCKET_SIZE,
            highPrice: (TOUCH_BUCKET + 30) * BUCKET_SIZE,
        });

        expect(priceCount(window.frames[0]!)).toBeLessThan(70);
    });

    it('keeps the prices inside the band rather than only counting them', async () => {
        const { source } = buildSource();

        const window = await source.fetchFramesAfter({
            symbol: 'BTCUSDT', afterMs: 0, maxFrames: 60,
            lowPrice: (TOUCH_BUCKET - 30) * BUCKET_SIZE,
            highPrice: (TOUCH_BUCKET + 30) * BUCKET_SIZE,
        });

        expect(Math.max(...window.frames[0]!.bids.quantities)).toBe(3);
    });

    it('carries every price when the reader named none', async () => {
        // A reader that has not framed itself on the book is looking for the
        // market, and clipping it to a band it never asked for hides the market
        // it is looking for.
        const { source } = buildSource();

        const window = await source.fetchFramesAfter({ symbol: 'BTCUSDT', afterMs: 0, maxFrames: 60 });

        expect(priceCount(window.frames[0]!)).toBe(4_000);
    });
});
