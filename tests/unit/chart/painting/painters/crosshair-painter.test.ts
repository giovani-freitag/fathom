import type { LiquidityFrame } from '../../../../../src/book/liquidity-frame.ts';
import type { TradeCluster } from '../../../../../src/trades/trade-cluster.ts';
import { AxisPainter } from '../../../../../src/chart/painting/painters/axis-painter.ts';
import { CrosshairPainter } from '../../../../../src/chart/painting/painters/crosshair-painter.ts';
import type { PaintContext } from '../../../../../src/chart/painting/render-types.ts';
import { describe, expect, it } from 'vitest';
import {
    buildPaintContext,
    createRecordingContext,
    type RecordingContext,
} from '../../../../mocks/canvas-context.ts';

const MID_PRICE = 78_500;
const TOUCH_BUCKET = MID_PRICE / 10;

function buildFrame(): LiquidityFrame {
    return {
        capturedAtMs: 1_500_000,
        bestBidPrice: MID_PRICE - 0.5,
        bestAskPrice: MID_PRICE + 0.5,
        bids: { lowestBucketIndex: TOUCH_BUCKET - 2, quantities: Float32Array.from([7, 8, 9]) },
        asks: { lowestBucketIndex: TOUCH_BUCKET, quantities: Float32Array.from([4, 5, 6]) },
    };
}

function buildCluster(overrides: Partial<TradeCluster> = {}): TradeCluster {
    return {
        executedAtMs: 1_500_000,
        priceBucketIndex: TOUCH_BUCKET,
        buyQuantity: 3,
        sellQuantity: 1,
        tradeCount: 12,
        largestTradeQuantity: 2,
        ...overrides,
    };
}

/** Places the cursor at a price and instant the caller cares about. */
function aimAt(paint: PaintContext, price: number, timestampMs: number): PaintContext {
    const pointer = { x: paint.projector.timeToX(timestampMs), y: paint.projector.priceToY(price) };
    return { ...paint, request: { ...paint.request, pointer }, crosshairY: pointer.y };
}

function readLabels(recording: RecordingContext): string[] {
    return recording.callsTo('fillText').map((call) => String(call.args[0]));
}

function buildPainter(): CrosshairPainter {
    return new CrosshairPainter({ axisPainter: new AxisPainter() });
}

describe('CrosshairPainter', () => {
    it('draws nothing without a pointer', () => {
        const recording = createRecordingContext();

        buildPainter().paint(buildPaintContext(recording, { dataset: { frames: [buildFrame()] } }));

        expect(recording.calls).toEqual([]);
    });

    it('pins the price under the cursor into the price axis', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(paint);

        expect(readLabels(recording).length).toBeGreaterThanOrEqual(1);
    });

    it('leaves the clock reading to the time axis, which can clear its own labels', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(paint);

        expect(readLabels(recording).some((label) => label.includes(':'))).toBe(false);
    });

    it('reports the size resting under the cursor', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE + 5, 1_500_000));

        expect(readLabels(recording).some((label) => label.startsWith('livro'))).toBe(true);
    });

    it('reports what traded there as well', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: {
                frames: [buildFrame()],
                clusters: [buildCluster()],
                clusterPriceBucketSize: 10,
                clusterIntervalMs: 5_000,
            },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE + 5, 1_500_000));

        expect(readLabels(recording).some((label) => label.startsWith('negoc.'))).toBe(true);
    });

    it('omits the traded line where nothing traded', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()], clusters: [], clusterPriceBucketSize: 10 },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE + 5, 1_500_000));

        expect(readLabels(recording).some((label) => label.startsWith('negoc.'))).toBe(false);
    });

    it('flips the readout to the left of a cursor near the right edge', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });
        const aimed = aimAt(paint, MID_PRICE + 5, 1_500_000);
        const pointer = { x: paint.layout.plotWidth - 4, y: aimed.request.pointer!.y };

        buildPainter().paint({ ...aimed, request: { ...aimed.request, pointer } });

        expect(Number(recording.callsTo('fillRect').at(-1)?.args[0])).toBeLessThan(pointer.x);
    });

    it('draws no readout where the book is empty', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, 78_000, 1_500_000));

        expect(readLabels(recording).some((label) => label.startsWith('livro'))).toBe(false);
    });
});
