import type { LiquidityFrame } from '../../../../../src/shared/core/liquidity-frame.ts';
import { AxisPainter } from '../../../../../src/app/painting/painters/axis-painter.ts';
import { TouchLinePainter } from '../../../../../src/app/painting/painters/touch-line-painter.ts';
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

describe('TouchLinePainter counting a bar down', () => {
    const INTERVAL_MS = 60_000;
    const NOW_MS = 1_900_000;

    function buildBars(closedAtMs: number, intervalMs = INTERVAL_MS) {
        return {
            instrumentSymbol: 'BTCUSDT',
            intervalMs,
            warmupBarsRequested: 0,
            warmupBarsReturned: 0,
            bars: [{
                openedAtMs: closedAtMs - intervalMs,
                closedAtMs,
                openPrice: 78_500, highPrice: 78_500, lowPrice: 78_500, closePrice: 78_500,
                buyVolume: 0, sellVolume: 0, tradeCount: 0,
                expectedFrames: 60, frameCount: 60, isClosed: false,
                firstFrameAtMs: closedAtMs - intervalMs, lastFrameAtMs: closedAtMs - 1_000,
            }],
        };
    }

    function paintWith(closedAtMs: number, intervalMs = INTERVAL_MS) {
        const recording = createRecordingContext();
        const paint = buildPaintContext(recording, {
            dataset: { frames: [buildFrame(78_500)], bars: buildBars(closedAtMs, intervalMs) },
            nowMs: NOW_MS,
        });

        buildPainter().paint(paint);
        return recording.callsTo('fillText').map((call) => String(call.args[0]));
    }

    it('writes what is left of the bar being built', () => {
        // The view ends 30 seconds into a minute bar.
        expect(paintWith(1_900_000 + 30_000)).toContain('30s');
    });

    it('writes minutes and seconds once past a minute', () => {
        // A five-minute bar, a minute and a half from closing.
        expect(paintWith(1_900_000 + 90_000, 300_000)).toContain('1:30');
    });

    it('counts nothing down on a bar the view has already left behind', () => {
        // Panned into history there is no bar being built, and a countdown
        // there would be counting down to a moment already past.
        const written = paintWith(1_900_000 - 10_000);

        expect(written.some((label) => label.endsWith('s'))).toBe(false);
    });
});
