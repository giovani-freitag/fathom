import type { LiquidityFrame } from '@fathom/contracts';
import { AxisPainter } from '@core/modules/rendering/painters/axis-painter';
import { TouchLinePainter } from '@core/modules/rendering/painters/touch-line-painter';
import { describe, expect, it } from 'vitest';
import { buildPaintContext, createRecordingContext } from '../../../../../mocks/canvas-context.ts';

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
