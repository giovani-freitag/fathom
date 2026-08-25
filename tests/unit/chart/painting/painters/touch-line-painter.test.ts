import type { LiquidityFrame } from '../../../../../src/book/liquidity-frame.ts';
import { AxisPainter } from '../../../../../src/chart/painting/painters/axis-painter.ts';
import { TouchLinePainter } from '../../../../../src/chart/painting/painters/touch-line-painter.ts';
import { describe, expect, it } from 'vitest';
import { buildPaintContext, createRecordingContext } from '../../../../mocks/canvas-context.ts';

function buildFrame(midPrice: number): LiquidityFrame {
    const touchBucket = Math.floor(midPrice / 10);
    return {
        capturedAtMs: 1_500_000,
        bestBidPrice: midPrice - 0.5,
        bestAskPrice: midPrice + 0.5,
        bids: { lowestBucketIndex: touchBucket - 1, quantities: Float32Array.from([1, 2]) },
        asks: { lowestBucketIndex: touchBucket, quantities: Float32Array.from([2]) },
    };
}

function buildPainter(): TouchLinePainter {
    return new TouchLinePainter({ axisPainter: new AxisPainter() });
}

describe('TouchLinePainter', () => {
    it('draws nothing before any frame is loaded', () => {
        const recording = createRecordingContext();

        buildPainter().paint(buildPaintContext(recording));

        expect(recording.callsTo('stroke')).toEqual([]);
    });

    it('spans the plot at the current mid price', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, { dataset: { frames: [buildFrame(78_500)] } });

        buildPainter().paint(paint);

        expect(recording.callsTo('lineTo')[0]?.args[0]).toBe(paint.layout.plotWidth);
    });

    it('pins the mid price into the axis', () => {
        const recording = createRecordingContext();

        buildPainter().paint(buildPaintContext(recording, { dataset: { frames: [buildFrame(78_500)] } }));

        expect(recording.callsTo('fillText').length).toBe(1);
    });

    it('yields its tag to a crosshair sitting on top of it', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, { dataset: { frames: [buildFrame(78_500)] } });
        const midY = paint.projector.priceToY(78_500);

        buildPainter().paint({ ...paint, crosshairY: midY + 2 });

        expect(recording.callsTo('fillText')).toEqual([]);
    });

    it('keeps its tag when the crosshair is clear of it', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, { dataset: { frames: [buildFrame(78_500)] } });
        const midY = paint.projector.priceToY(78_500);

        buildPainter().paint({ ...paint, crosshairY: midY + 80 });

        expect(recording.callsTo('fillText').length).toBe(1);
    });

    it('draws nothing when the touch is scrolled off the plot', () => {
        const recording = createRecordingContext();

        buildPainter().paint(buildPaintContext(recording, { dataset: { frames: [buildFrame(90_000)] } }));

        expect(recording.callsTo('stroke')).toEqual([]);
    });
});

describe('TouchLinePainter in history', () => {
    function buildFrameAt(capturedAtMs: number, midPrice: number): LiquidityFrame {
        const touchBucket = Math.floor(midPrice / 10);
        return {
            capturedAtMs,
            bestBidPrice: midPrice - 0.5,
            bestAskPrice: midPrice + 0.5,
            bids: { lowestBucketIndex: touchBucket - 1, quantities: Float32Array.from([1, 2]) },
            asks: { lowestBucketIndex: touchBucket, quantities: Float32Array.from([2]) },
        };
    }

    it('marks the price at the right edge, not the newest frame loaded', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: {
                frames: [buildFrameAt(1_500_000, 78_400), buildFrameAt(9_000_000, 78_900)],
            },
        });

        buildPainter().paint(paint);

        const drawnY = Number(recording.callsTo('moveTo')[0]?.args[1]);
        expect(Math.abs(drawnY - paint.projector.priceToY(78_400))).toBeLessThan(2);
    });

    it('still marks the current touch while the chart follows the live edge', () => {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrameAt(1_800_000, 78_600), buildFrameAt(1_899_000, 78_650)] },
        });

        buildPainter().paint(paint);

        const drawnY = Number(recording.callsTo('moveTo')[0]?.args[1]);
        expect(Math.abs(drawnY - paint.projector.priceToY(78_650))).toBeLessThan(2);
    });
});
