import { buildPaintContext, createRecordingContext } from '../../../../mocks/canvas-context.ts';
import type { DrawPlan, PlotSeries } from '../../../../../src/shared/core/draw-plan.ts';
import { describe, expect, it } from 'vitest';
import { PLOT_BUDGET } from '../../../../../src/shared/core/draw-plan.ts';
import { PlotPainter } from '../../../../../src/app/painting/painters/plot-painter.ts';

function buildSeries(overrides: Partial<PlotSeries> = {}): PlotSeries {
    return {
        label: 'indicator.ema',
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
        label: 'indicator.ema',
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

describe('PlotPainter drawing a histogram', () => {
    function paintHistogram(overrides: Partial<PlotSeries> = {}) {
        const recording = createRecordingContext();
        new PlotPainter().paintOverPrice(buildPaintContext(recording, {
            plans: [buildPlan({
                scale: { kind: 'overlay', heightRatio: 0.2 },
                series: [buildSeries({
                    shape: 'histogram',
                    baseline: 0,
                    atMs: Float64Array.from([1_200_000, 1_400_000, 1_600_000]),
                    value: Float64Array.from([5, -3, 8]),
                    ...overrides,
                })],
            })],
        }));
        return recording;
    }

    it('draws a column for each bar it was given', () => {
        expect(paintHistogram().callsTo('fillRect').length).toBe(3);
    });

    it('leaves out a bar the arithmetic had nothing to say about', () => {
        // A blank is not a nought: a column drawn at nought would claim the
        // reading was zero there rather than absent.
        const recording = paintHistogram({ value: Float64Array.from([5, Number.NaN, 8]) });

        expect(recording.callsTo('fillRect').length).toBe(2);
    });

    it('never collapses a column to nothing, however small the reading', () => {
        const recording = paintHistogram({ value: Float64Array.from([1e-9, 1e-9, 1e-9]) });

        for (const call of recording.callsTo('fillRect')) {
            expect(Number(call.args[3])).toBeGreaterThanOrEqual(1);
        }
    });

    it('colours a bar under the baseline in its own tone', () => {
        // What makes a MACD histogram readable: the sign is the reading. A
        // symmetric scale takes a band of its own, so it is painted there.
        const recording = createRecordingContext();
        new PlotPainter().paintInPanes(buildPaintContext(recording, {
            plans: [buildPlan({
                scale: { kind: 'symmetric' },
                series: [buildSeries({
                    shape: 'histogram',
                    baseline: 0,
                    negativeTone: 'ask',
                    value: Float64Array.from([5, -3, 8]),
                })],
            })],
        }));

        const tones = new Set(recording.callsTo('fillRect').map((call) => call.fillStyle));
        expect(tones.size).toBe(2);
    });
});

describe('PlotPainter shading a band', () => {
    function paintBand() {
        const recording = createRecordingContext();
        new PlotPainter().paintOverPrice(buildPaintContext(recording, {
            plans: [buildPlan({
                indicatorId: 'bollinger',
                series: [
                    buildSeries({ value: Float64Array.from([78_700, 78_800, 78_750]) }),
                    buildSeries({ value: Float64Array.from([78_300, 78_400, 78_350]) }),
                ],
                bands: [{ tone: 'violet', upperSeriesIndex: 0, lowerSeriesIndex: 1 }],
            })],
        }));
        return recording;
    }

    it('fills the region between the two series it names', () => {
        expect(paintBand().callsTo('fill').length).toBeGreaterThan(0);
    });

    it('draws the two series as well as the shading between them', () => {
        expect(paintBand().callsTo('stroke').length).toBeGreaterThanOrEqual(2);
    });

    it('shades nothing when the band names a series that is not there', () => {
        const recording = createRecordingContext();
        new PlotPainter().paintOverPrice(buildPaintContext(recording, {
            plans: [buildPlan({
                bands: [{ tone: 'violet', upperSeriesIndex: 0, lowerSeriesIndex: 9 }],
            })],
        }));

        expect(recording.callsTo('fill')).toEqual([]);
    });
});

describe('PlotPainter drawing a level', () => {
    function paintLevels(isDashed: boolean) {
        const recording = createRecordingContext();
        new PlotPainter().paintInPanes(buildPaintContext(recording, {
            plans: [buildPlan({
                indicatorId: 'rsi',
                scale: { kind: 'fixed', low: 0, high: 100 },
                series: [buildSeries({ value: Float64Array.from([40, 60, 55]) })],
                levels: [{ value: 30, tone: 'muted', isDashed }, { value: 70, tone: 'muted', isDashed }],
            })],
        }));
        return recording;
    }

    it('rules a line across the band at each level it was given', () => {
        // The thirty and the seventy are what make a strength reading mean
        // anything; a band without them is a wiggle between nought and a hundred.
        expect(paintLevels(true).callsTo('stroke').length).toBeGreaterThanOrEqual(2);
    });

    it('dashes the ones that ask to be dashed, and only those', () => {
        const dashed = paintLevels(true).callsTo('setLineDash').filter(
            (call) => Array.isArray(call.args[0]) && (call.args[0] as unknown[]).length > 0,
        );
        const solid = paintLevels(false).callsTo('setLineDash').filter(
            (call) => Array.isArray(call.args[0]) && (call.args[0] as unknown[]).length > 0,
        );

        expect(dashed.length).toBeGreaterThan(solid.length);
    });
});

describe('PlotPainter drawing a series as marks', () => {
    it('draws one mark per sample rather than a path through them', () => {
        const recording = paintWith({ series: [buildSeries({ shape: 'dot' })] });

        expect(recording.callsTo('arc')).toHaveLength(3);
    });

    it('joins none of the marks up', () => {
        const recording = paintWith({ series: [buildSeries({ shape: 'dot' })] });

        expect(recording.callsTo('lineTo')).toEqual([]);
    });

    it('leaves out the samples the series has nothing to say about', () => {
        const value = Float64Array.from([78_500, Number.NaN, 78_550]);
        const recording = paintWith({ series: [buildSeries({ shape: 'dot', value })] });

        expect(recording.callsTo('arc')).toHaveLength(2);
    });

    it('draws a wider mark when the series asks for one', () => {
        const radiusFor = (widthPx?: number): number => {
            const overrides = widthPx === undefined ? {} : { widthPx };
            const recording = paintWith({ series: [buildSeries({ shape: 'dot', ...overrides })] });
            return Number(recording.callsTo('arc')[0]?.args[2]);
        };

        expect(radiusFor(12)).toBeGreaterThan(radiusFor());
    });
});

describe('PlotPainter naming what it drew', () => {
    /** Everything written on the canvas, in the order it was written. */
    function writtenBy(recording: ReturnType<typeof createRecordingContext>): string[] {
        return recording.callsTo('fillText').map((call) => String(call.args[0]));
    }

    it('writes nothing over the price for a plan that did not ask', () => {
        // A mean and its channel are told apart by where they sit. Naming every
        // line would be three words over the price for nothing.
        const recording = paintWith({});

        expect(writtenBy(recording)).toEqual([]);
    });

    it('names every line of a plan whose lines are only meaningful named', () => {
        const recording = paintWith({
            namesItsSeries: true,
            series: [
                buildSeries({ label: 'indicator.pivots.r1', value: Float64Array.from([78_600, 78_600, 78_600]) }),
                buildSeries({ label: 'indicator.pivots.s1', value: Float64Array.from([78_400, 78_400, 78_400]) }),
            ],
        });

        expect(writtenBy(recording)).toEqual(['R1', 'S1']);
    });

    it('says nothing about a line that is off the screen', () => {
        // A name ranged against the edge claims its line is somewhere on that
        // edge, and a level far above the visible prices is not.
        const recording = paintWith({
            namesItsSeries: true,
            series: [buildSeries({
                label: 'indicator.pivots.r3',
                value: Float64Array.from([9_000_000, 9_000_000, 9_000_000]),
            })],
        });

        expect(writtenBy(recording)).toEqual([]);
    });

    it('says nothing for a line that drew nothing at all', () => {
        const recording = paintWith({
            namesItsSeries: true,
            series: [buildSeries({ value: Float64Array.from([NaN, NaN, NaN]) })],
        });

        expect(writtenBy(recording)).toEqual([]);
    });

    it('tells two copies of one reading apart by how each was tuned', () => {
        // Sharing a band, two of the same reading are the same name and the
        // same shape. What differs is the number a reader chose.
        const recording = createRecordingContext();

        new PlotPainter().paintInPanes(buildPaintContext(recording, {
            plans: [
                buildPlan({ instanceId: 'rsi-1', label: 'indicator.rsi', parameterSummary: '14', scale: { kind: 'auto' } }),
                buildPlan({ instanceId: 'rsi-2', label: 'indicator.rsi', parameterSummary: '50', scale: { kind: 'auto' }, bandKey: 'shared' }),
            ],
        }));

        const titles = writtenBy(recording).filter((text) => text.includes('RSI'));
        expect(titles.some((text) => text.includes('14')) && titles.some((text) => text.includes('50')))
            .toBe(true);
    });

    it('names the band a stack of them is otherwise only numbers beside', () => {
        const recording = createRecordingContext();

        new PlotPainter().paintInPanes(buildPaintContext(recording, {
            plans: [buildPlan({ label: 'indicator.cvd', scale: { kind: 'auto' } })],
        }));

        expect(writtenBy(recording).some((text) => text.startsWith('Cumulative delta'))).toBe(true);
    });
});
