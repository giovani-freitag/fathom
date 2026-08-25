import { describe, expect, it } from 'vitest';
import {
    decodeLiquidityFrameWindow,
    encodeLiquidityFrameWindow,
    HeatmapCodecError,
    measureEncodedByteLength,
} from '../../../src/shared/codec/heatmap-codec.ts';
import type { LiquidityFrameWindow } from '../../../src/shared/core/liquidity-frame.ts';

function buildWindow(): LiquidityFrameWindow {
    return {
        priceBucketSize: 10,
        sampleIntervalMs: 1_000,
        frames: [
            {
                capturedAtMs: 1_787_606_652_000,
                bestBidPrice: 78_945.7,
                bestAskPrice: 78_945.8,
                bids: { lowestBucketIndex: 7_890, quantities: Float32Array.from([1.5, 0, 3.25, 12]) },
                asks: { lowestBucketIndex: 7_894, quantities: Float32Array.from([0.5, 8, 0]) },
            },
            {
                capturedAtMs: 1_787_606_653_000,
                bestBidPrice: 78_946.1,
                bestAskPrice: 78_946.2,
                bids: { lowestBucketIndex: 7_891, quantities: Float32Array.from([2, 4]) },
                asks: { lowestBucketIndex: 7_894, quantities: Float32Array.from([7.75]) },
            },
        ],
    };
}

describe('encodeLiquidityFrameWindow', () => {
    it('round-trips every field of every frame', () => {
        const original = buildWindow();

        const decoded = decodeLiquidityFrameWindow(encodeLiquidityFrameWindow(original));

        expect(decoded).toEqual(original);
    });

    it('produces exactly the measured byte length', () => {
        const original = buildWindow();

        const encoded = encodeLiquidityFrameWindow(original);

        expect(encoded.byteLength).toBe(measureEncodedByteLength(original));
    });

    it('encodes a window holding no frames', () => {
        const empty: LiquidityFrameWindow = { priceBucketSize: 10, sampleIntervalMs: 500, frames: [] };

        const decoded = decodeLiquidityFrameWindow(encodeLiquidityFrameWindow(empty));

        expect(decoded).toEqual(empty);
    });

    it('preserves a ladder that is entirely empty on one side', () => {
        const original: LiquidityFrameWindow = {
            priceBucketSize: 5,
            sampleIntervalMs: 1_000,
            frames: [{
                capturedAtMs: 1_000,
                bestBidPrice: 10,
                bestAskPrice: 11,
                bids: { lowestBucketIndex: 1, quantities: Float32Array.from([4]) },
                asks: { lowestBucketIndex: 2, quantities: new Float32Array(0) },
            }],
        };

        const decoded = decodeLiquidityFrameWindow(encodeLiquidityFrameWindow(original));

        expect(decoded.frames[0]?.asks.quantities.length).toBe(0);
    });

    it('refuses frames that are not in ascending capture order', () => {
        const outOfOrder = buildWindow();
        const reversed: LiquidityFrameWindow = { ...outOfOrder, frames: [...outOfOrder.frames].reverse() };

        expect(() => encodeLiquidityFrameWindow(reversed)).toThrow(HeatmapCodecError);
    });
});

describe('decodeLiquidityFrameWindow', () => {
    it('rejects a payload that does not carry the format magic', () => {
        const foreign = new ArrayBuffer(64);

        expect(() => decodeLiquidityFrameWindow(foreign)).toThrow(HeatmapCodecError);
    });

    it('rejects a payload shorter than the window header', () => {
        const truncated = new ArrayBuffer(8);

        expect(() => decodeLiquidityFrameWindow(truncated)).toThrow(HeatmapCodecError);
    });

    it('rejects a payload truncated inside a frame', () => {
        const encoded = encodeLiquidityFrameWindow(buildWindow());

        expect(() => decodeLiquidityFrameWindow(encoded.slice(0, encoded.byteLength - 8)))
            .toThrow(HeatmapCodecError);
    });

    it('views the payload buffer instead of copying the quantities', () => {
        const encoded = encodeLiquidityFrameWindow(buildWindow());

        const decoded = decodeLiquidityFrameWindow(encoded);

        expect(decoded.frames[0]?.bids.quantities.buffer).toBe(encoded);
    });
});
