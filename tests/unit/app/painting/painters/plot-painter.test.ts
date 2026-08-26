import { buildPaintContext, createRecordingContext } from '../../../../mocks/canvas-context.ts';
import type { DrawPlan, PlotSeries } from '../../../../../src/shared/core/draw-plan.ts';
import { describe, expect, it } from 'vitest';
import { PLOT_BUDGET } from '../../../../../src/shared/core/draw-plan.ts';
import { PlotPainter } from '../../../../../src/app/painting/painters/plot-painter.ts';

function buildSeries(overrides: Partial<PlotSeries> = {}): PlotSeries {
    return {
        labelKey: 'indicator.ema',
        tone: 'phosphor',
        shape: 'line',
        atMs: Float64Array.from([1_200_000, 1_400_000, 1_600_000]),
        value: Float64Array.from([78_500, 78_600, 78_550]),
        ...overrides,
    };
}

function buildPlan(overrides: Partial<DrawPlan> = {}): DrawPlan {
    return {
        indicatorId: 'ema',
        labelKey: 'indicator.ema',
        parameterSummary: '20',
        scale: { kind: 'price' },
        series: [buildSeries()],
        hasConverged: true,
        ...overrides,
    };
}

function paintWith(plan: Partial<DrawPlan>) {
    const recording = createRecordingContext();
    new PlotPainter().paintOverPrice(buildPaintContext(recording, { plans: [buildPlan(plan)] }));
    return recording;
}

describe('PlotPainter', () => {
    it('strokes one path through the vertices it was given', () => {
        const recording = paintWith({});

        expect(recording.callsTo('moveTo').length).toBe(1);
        expect(recording.callsTo('lineTo').length).toBe(2);
        expect(recording.callsTo('stroke').length).toBe(1);
    });

    it('breaks the line where the series has nothing to say', () => {
        // A line bridged across a hole draws a trend through unrecorded time.
        const recording = paintWith({
            series: [buildSeries({ value: Float64Array.from([78_500, Number.NaN, 78_550]) })],
        });

        expect(recording.callsTo('moveTo').length).toBe(2);
        expect(recording.callsTo('lineTo').length).toBe(0);
    });

    it('dashes a series that has not converged, so it does not read as settled', () => {
        const converged = paintWith({ hasConverged: true });
        const seeded = paintWith({ hasConverged: false });

        const dashOf = (recording: ReturnType<typeof paintWith>) =>
            recording.callsTo('setLineDash')[0]?.args[0] as number[];
        expect(dashOf(converged)).toEqual([]);
        expect(dashOf(seeded).length).toBeGreaterThan(0);
    });

    it('resolves the tone against the palette rather than taking a colour', () => {
        // A plan that named a colour would be wrong the moment the theme flipped,
        // and a plan is held between frames.
        const recording = paintWith({});

        expect(recording.callsTo('stroke')[0]?.strokeStyle).toMatch(/^#|^rgba/);
    });

    it('rejects a plan past its budget whole, rather than drawing part of it', () => {
        const tooMany = PLOT_BUDGET.maximumVerticesPerSeries + 1;
        const recording = paintWith({
            series: [buildSeries({
                atMs: new Float64Array(tooMany),
                value: new Float64Array(tooMany),
            })],
        });

        expect(recording.callsTo('stroke')).toEqual([]);
    });

    it('rejects a series whose vertices do not pair up', () => {
        const recording = paintWith({
            series: [buildSeries({ value: Float64Array.from([78_500]) })],
        });

        expect(recording.callsTo('stroke')).toEqual([]);
    });
});
