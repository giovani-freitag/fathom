import type { LiquidityFrame } from '../../../../../src/shared/core/liquidity-frame.ts';
import type { TradeCluster } from '../../../../../src/shared/core/trade-cluster.ts';
import { AxisPainter } from '../../../../../src/app/painting/painters/axis-painter.ts';
import { CrosshairPainter } from '../../../../../src/app/painting/painters/crosshair-painter.ts';
import type { PaintContext } from '../../../../../src/app/painting/render-types.ts';
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

    it('names the moment under the cursor to the second', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(paint);

        expect(readLabels(recording).some((label) => /\d{2}:\d{2}:\d{2}/.test(label))).toBe(true);
    });

    it('carries the calendar date, which the time axis never shows', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(paint);

        expect(readLabels(recording).some((label) => /\d{4} ·/.test(label))).toBe(true);
    });

    it('reports the moment of the frame, not of the pixel between frames', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE + 5, 1_500_400));

        const expected = new Intl.DateTimeFormat('pt-BR', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).format(new Date(1_500_000));
        expect(readLabels(recording).some((label) => label.endsWith(expected))).toBe(true);
    });

    it('names the side resting under the cursor, not just the size', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE + 15, 1_500_000));

        expect(readLabels(recording).some((label) => label.startsWith('VENDA'))).toBe(true);
    });

    it('calls the other side a bid', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE - 15, 1_500_000));

        expect(readLabels(recording).some((label) => label.startsWith('COMPRA'))).toBe(true);
    });

    it('spells the price the size is resting at', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE + 5, 1_500_000));

        expect(readLabels(recording).some((label) => label.includes('em 78.500'))).toBe(true);
    });

    it('measures how far the level sits from the middle of the book', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE + 25, 1_500_000));

        expect(readLabels(recording).some((label) => label.includes('do meio'))).toBe(true);
    });

    it('signs the distance so the direction is unmistakable', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE - 25, 1_500_000));

        expect(readLabels(recording).some((label) => label.startsWith('-'))).toBe(true);
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

    it('splits what traded by which side crossed the spread', () => {
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

        const traded = readLabels(recording).find((label) => label.startsWith('negoc.'));
        expect(traded).toContain('venda');
    });

    it('names only the side that actually traded', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: {
                frames: [buildFrame()],
                clusters: [buildCluster({ sellQuantity: 0 })],
                clusterPriceBucketSize: 10,
                clusterIntervalMs: 5_000,
            },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE + 5, 1_500_000));

        const traded = readLabels(recording).find((label) => label.startsWith('negoc.'));
        expect(traded).not.toContain('venda');
    });

    it('reports the biggest single trade, which a total hides', () => {
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

        expect(readLabels(recording).some((label) => label.includes('maior'))).toBe(true);
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

        expect(Number(recording.callsTo('roundRect').at(-1)?.args[0])).toBeLessThan(pointer.x);
    });

    it('rounds the readout corners rather than cutting them square', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE + 15, 1_500_000));

        expect(recording.callsTo('roundRect').at(-1)?.args[4]).toBeGreaterThan(0);
    });

    it('keeps the text clear of the border on every side', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, MID_PRICE + 15, 1_500_000));

        const box = recording.callsTo('roundRect').at(-1)!.args;
        const firstLineY = Number(recording.callsTo('fillText').at(0)?.args[2]);
        expect([
            Number(recording.callsTo('fillText').at(0)?.args[1]) - Number(box[0]),
            firstLineY - Number(box[1]),
        ].every((gap) => gap >= 8)).toBe(true);
    });

    it('says so plainly where nothing is resting', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame()] },
            pointer: { x: 300, y: 200 },
        });

        buildPainter().paint(aimAt(paint, 78_000, 1_500_000));

        expect(readLabels(recording).some((label) => label.startsWith('sem ordem'))).toBe(true);
    });
});
