import { buildPaintContext, createRecordingContext } from '../../../../mocks/canvas-context.ts';
import { RENDER_PALETTE } from '../../../../../src/app/painting/render-palette.ts';
import { CandlePainter } from '../../../../../src/app/painting/painters/candle-painter.ts';
import { describe, expect, it } from 'vitest';
import type { PriceBar, PriceBarWindow } from '../../../../../src/shared/core/price-bar.ts';

const INTERVAL_MS = 60_000;

function buildBar(openedAtMs: number, overrides: Partial<PriceBar> = {}): PriceBar {
    return {
        openedAtMs,
        closedAtMs: openedAtMs + INTERVAL_MS,
        openPrice: 78_500,
        highPrice: 78_600,
        lowPrice: 78_400,
        closePrice: 78_550,
        expectedFrames: 60,
        frameCount: 60,
        isClosed: true,
        firstFrameAtMs: openedAtMs,
        lastFrameAtMs: openedAtMs + 59_000,
        ...overrides,
    };
}

function buildWindow(bars: PriceBar[], warmupBarsReturned = 0): PriceBarWindow {
    return {
        instrumentSymbol: 'BTCUSDT',
        intervalMs: INTERVAL_MS,
        warmupBarsRequested: warmupBarsReturned,
        warmupBarsReturned,
        bars,
    };
}

function paintWith(bars: PriceBarWindow) {
    const recording = createRecordingContext();
    new CandlePainter().paint(buildPaintContext(recording, { dataset: { bars } }));
    return recording;
}

describe('CandlePainter', () => {
    it('draws nothing without bars', () => {
        expect(paintWith(buildWindow([])).calls).toEqual([]);
    });

    it('fills a body for each bar', () => {
        const recording = paintWith(buildWindow([buildBar(1_400_000), buildBar(1_460_000)]));

        expect(recording.callsTo('fillRect').length).toBe(2);
    });

    it('leaves out a bar that closed before the window opened', () => {
        const recording = paintWith(buildWindow([buildBar(600_000)]));

        expect(recording.callsTo('fillRect')).toEqual([]);
    });

    it('strokes a wick between the high and the low', () => {
        const recording = paintWith(buildWindow([
            buildBar(1_400_000, { lowPrice: 78_100, highPrice: 78_900 }),
        ]));

        const [moveTo, lineTo] = [recording.callsTo('moveTo')[0], recording.callsTo('lineTo')[0]];
        expect(moveTo?.args[0]).toBe(lineTo?.args[0]);
        expect(Number(lineTo?.args[1])).toBeGreaterThan(Number(moveTo?.args[1]));
    });

    it('colours a rising bar differently from a falling one', () => {
        const rising = paintWith(buildWindow([buildBar(1_400_000, { openPrice: 78_400, closePrice: 78_600 })]));
        const falling = paintWith(buildWindow([buildBar(1_400_000, { openPrice: 78_600, closePrice: 78_400 })]));

        expect(rising.callsTo('fillRect')[0]?.fillStyle)
            .not.toBe(falling.callsTo('fillRect')[0]?.fillStyle);
    });

    it('never collapses a flat bar to nothing', () => {
        const recording = paintWith(buildWindow([
            buildBar(1_400_000, { openPrice: 78_500, closePrice: 78_500 }),
        ]));

        expect(Number(recording.callsTo('fillRect')[0]?.args[3])).toBeGreaterThan(0);
    });

    it('does not draw the warm-up the averages were seeded from', () => {
        // Warm-up is history the window is not claiming to cover; drawing it
        // would show bars to the left of the range the reader asked for.
        const recording = paintWith(buildWindow(
            [buildBar(1_340_000), buildBar(1_400_000), buildBar(1_460_000)],
            1,
        ));

        expect(recording.callsTo('fillRect').length).toBe(2);
    });
});

describe('CandlePainter and what each bar was built from', () => {
    it('fills a bar every second of which was recorded', () => {
        const recording = paintWith(buildWindow([buildBar(1_400_000)]));

        expect(recording.callsTo('fillRect').length).toBe(1);
        expect(recording.callsTo('strokeRect')).toEqual([]);
    });

    it('outlines a bar the collector missed seconds of rather than filling it', () => {
        // Filled, it claims price moved through time nothing was recorded in —
        // which is the error the gap band exists to prevent.
        const recording = paintWith(buildWindow([buildBar(1_400_000, { frameCount: 3 })]));

        expect(recording.callsTo('fillRect')).toEqual([]);
        expect(recording.callsTo('strokeRect').length).toBe(1);
    });

    it('marks a partial bar in the same amber the gap band uses', () => {
        const recording = paintWith(buildWindow([buildBar(1_400_000, { frameCount: 3 })]));

        expect(recording.callsTo('strokeRect')[0]?.strokeStyle)
            .toBe(RENDER_PALETTE.gapStroke);
    });

    it('leaves a bar that is still being written hollow, not amber', () => {
        // A bucket that has not finished is not a bucket with something wrong.
        const recording = paintWith(buildWindow([
            buildBar(1_400_000, { frameCount: 8, isClosed: false }),
        ]));

        expect(recording.callsTo('strokeRect').length).toBe(1);
        expect(recording.callsTo('strokeRect')[0]?.strokeStyle)
            .not.toBe(RENDER_PALETTE.gapStroke);
    });

    it('marks the stretch where no bucket exists at all', () => {
        const recording = paintWith(buildWindow([buildBar(1_400_000), buildBar(1_520_000)]));

        expect(recording.callsTo('setLineDash').some((call) =>
            Array.isArray(call.args[0]) && (call.args[0] as number[]).length > 0)).toBe(true);
    });

    it('says nothing about a stretch that has no hole in it', () => {
        const recording = paintWith(buildWindow([buildBar(1_400_000), buildBar(1_460_000)]));

        expect(recording.callsTo('setLineDash').every((call) =>
            Array.isArray(call.args[0]) && (call.args[0] as number[]).length === 0)).toBe(true);
    });
});
