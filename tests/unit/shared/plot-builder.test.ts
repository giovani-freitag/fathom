import { describe, expect, it } from 'vitest';
import { Params, Plot } from '../../../src/shared/core/addon-api.ts';
import { VOLUME_DELTA } from '../../../src/app/indicators/volume-delta/volume-delta.ts';
import { SIMPLE_AVERAGE } from '../../../src/app/indicators/simple-average/simple-average.ts';
import { buildRun, buildWindow } from '../../mocks/price-bars.ts';

const BARS = buildWindow(buildRun(8, (index) => 100 + index).map((bar, index) => ({
    ...bar,
    buyVolume: index,
    sellVolume: 8 - index,
})));

/** A series of the right length, so the shape under test is the only variable. */
function blank(value = 0): number[] {
    return BARS.bars.map(() => value);
}

describe('a plan built through the facade', () => {
    it('is the same object the reading writes by hand', () => {
        // The claim the facade rests on: it sets fields on the draft the host
        // was always going to be given, so nothing is lost by using it and
        // nothing has to be translated back.
        const byHand = VOLUME_DELTA.compute({ bars: BARS, settings: {}, sessions: {} });

        const built = Plot.over(BARS)
            .histogram(byHand.series[0]!.value, 'indicator.delta')
            .risingAndFalling()
            .at(0)
            .aboutZero();

        expect({ ...built, scale: undefined }).toEqual({ ...byHand, scale: undefined });
        expect(built.scale).toEqual(VOLUME_DELTA.scale);
    });

    it('carries a line through the same fields as one written out', () => {
        const settings = { periodBars: 3, source: 'close' };
        const byHand = SIMPLE_AVERAGE.compute({ bars: BARS, settings, sessions: {} });

        const built = Plot.over(BARS)
            .line(byHand.series[0]!.value, 'indicator.sma')
            .in('ink')
            .overThePrice();

        expect({ ...built, scale: undefined }).toEqual({ ...byHand, scale: undefined });
        expect(built.scale).toEqual(SIMPLE_AVERAGE.scale);
    });
});

describe('what the builder puts on a draft', () => {
    it('leaves out what was never asked for', () => {
        const draft = Plot.over(BARS).line(blank()).overThePrice();

        expect(Object.keys(draft).sort()).toEqual(['scale', 'series']);
    });

    it('colours only the series added last', () => {
        const draft = Plot.over(BARS)
            .line(blank(1), 'first').in('amber')
            .line(blank(2), 'second').in('cyan')
            .overThePrice();

        expect(draft.series.map((one) => one.tone)).toEqual(['amber', 'cyan']);
    });

    it('adds one line per name, in the order given', () => {
        const draft = Plot.over(BARS).lines({ R1: blank(3), Pivot: blank(2), S1: blank(1) }).overThePrice();

        expect(draft.series.map((one) => one.label)).toEqual(['R1', 'Pivot', 'S1']);
    });

    it('shades between two series in the upper one colour by default', () => {
        const draft = Plot.over(BARS)
            .line(blank(2), 'upper').in('violet')
            .line(blank(1), 'lower')
            .shading(0, 1)
            .inItsOwnBand();

        expect(draft.bands).toEqual([{ upperSeriesIndex: 0, lowerSeriesIndex: 1, tone: 'violet' }]);
    });

    it('takes any array the arithmetic produced', () => {
        const draft = Plot.over(BARS).line(Float32Array.from(BARS.bars.map(() => 1.5))).overThePrice();

        expect([...draft.series[0]!.value]).toEqual(BARS.bars.map(() => 1.5));
    });

    it('lines every series up with the same instants', () => {
        const draft = Plot.over(BARS).line(blank(1)).line(blank(2)).overThePrice();

        expect(draft.series[0]!.atMs).toBe(draft.series[1]!.atMs);
    });

    it('says nothing about colour when a tone was never named', () => {
        // Ignored rather than thrown: colouring nothing is what a plan with no
        // series means, and an addon should not have to guard the empty case.
        const draft = Plot.over(BARS).in('amber').overThePrice();

        expect(draft.series).toEqual([]);
    });

    it('refuses a series that does not line up with the bars', () => {
        // Left to the budget check this is a plan rejected whole and in
        // silence: it stops drawing and nothing says why.
        expect(() => Plot.over(BARS).line([1, 2, 3])).toThrow(/one value per drawn bar/);
    });
});

describe('a knob built through the facade', () => {
    it('is usable before any step is taken', () => {
        expect(Params.integer('periodBars')).toMatchObject({
            name: 'periodBars',
            kind: 'integer',
        });
    });

    it('carries every step without a closing call', () => {
        const parameter = Params.integer('periodBars')
            .called('Period')
            .between(2, 400)
            .startingAt(20)
            .by(5);

        expect(parameter).toMatchObject({
            name: 'periodBars',
            kind: 'integer',
            label: 'Period',
            minimum: 2,
            maximum: 400,
            defaultValue: 20,
            step: 5,
        });
    });

    it('starts a choice on the first answer offered', () => {
        expect(Params.choice('source', ['close', 'open']).defaultValue).toBe('close');
    });

    it('leaves the parameter it was built from untouched', () => {
        // Each step returns a new one, so a knob shared between two readings
        // cannot be retuned by either.
        const base = Params.decimal('multiplier');

        base.startingAt(3);

        expect(base.defaultValue).toBe(1);
    });
});
