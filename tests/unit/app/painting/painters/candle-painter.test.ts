import { CandlePainter } from '../../../../../src/app/painting/painters/candle-painter.ts';
import { describe, expect, it } from 'vitest';
import type { LiquidityFrame } from '../../../../../src/shared/core/liquidity-frame.ts';
import { buildPaintContext, createRecordingContext } from '../../../../mocks/canvas-context.ts';

function buildFrame(capturedAtMs: number, midPrice: number): LiquidityFrame {
    return {
        capturedAtMs,
        bestBidPrice: midPrice - 0.5,
        bestAskPrice: midPrice + 0.5,
        bids: { lowestBucketIndex: 7_840, quantities: Float32Array.from([5]) },
        asks: { lowestBucketIndex: 7_850, quantities: Float32Array.from([5]) },
    };
}

function paintWith(frames: readonly LiquidityFrame[]) {
    const recording = createRecordingContext();
    const paint = buildPaintContext(recording, { dataset: { frames } });
    new CandlePainter().paint(paint);
    return recording;
}

describe('CandlePainter', () => {
    it('leaves out a candle whose bin closed before the window opened', () => {
        const recording = paintWith([buildFrame(1_000_000, 78_500)]);

        expect(recording.callsTo('fillRect')).toEqual([]);
    });

    it('draws nothing without frames', () => {
        expect(paintWith([]).calls).toEqual([]);
    });

    it('fills a body for each candle', () => {
        const recording = paintWith([buildFrame(1_400_000, 78_500)]);

        expect(recording.callsTo('fillRect').length).toBeGreaterThan(0);
    });

    it('strokes a wick between the high and the low', () => {
        const recording = paintWith([
            buildFrame(1_400_000, 78_500),
            buildFrame(1_401_000, 78_900),
        ]);

        expect(recording.callsTo('moveTo').length).toBeGreaterThan(0);
    });

    it('colours a rising candle differently from a falling one', () => {
        const rising = paintWith([buildFrame(1_400_000, 78_400), buildFrame(1_401_000, 78_900)]);
        const falling = paintWith([buildFrame(1_400_000, 78_900), buildFrame(1_401_000, 78_400)]);
        const fillOf = (recording: ReturnType<typeof paintWith>) =>
            recording.callsTo('fillRect').at(0)?.fillStyle;

        expect(fillOf(rising)).not.toBe(fillOf(falling));
    });

    it('never collapses a flat candle to nothing', () => {
        const recording = paintWith([buildFrame(1_400_000, 78_500), buildFrame(1_401_000, 78_500)]);

        expect(Number(recording.callsTo('fillRect').at(0)?.args[3])).toBeGreaterThan(0);
    });
});
