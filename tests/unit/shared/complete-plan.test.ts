import { describe, expect, it } from 'vitest';
import { completePlan, summariseParameters } from '../../../src/shared/core/draw-plan.ts';
import type {
    Indicator,
    IndicatorInput,
    IndicatorParameter,
    IndicatorSettings,
    PlanDraft,
    PlotScale,
} from '../../../src/shared/core/draw-plan.ts';

const PERIOD_BARS: IndicatorParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 20,
    minimum: 2,
    maximum: 400,
};

const SOURCE: IndicatorParameter = {
    name: 'source',
    kind: 'choice',
    defaultValue: 'close',
    choices: ['close', 'open'],
};

/** A reading with nothing but a name, for asking what the host fills in. */
function buildIndicator(overrides: Partial<Indicator> = {}): Indicator {
    return {
        label: 'A phrase, not a key',
        scale: { kind: 'price' } satisfies PlotScale,
        parameters: [PERIOD_BARS, SOURCE],
        resolveSources: (settings: IndicatorSettings) => ({ warmupBars: Number(settings['periodBars'] ?? 20) }),
        compute: (): PlanDraft => ({ series: [] }),
        ...overrides,
    };
}

function stamp(draft: PlanDraft, overrides: Partial<Indicator> = {}, warmupBarCount = 20) {
    return completePlan(
        {
            indicatorId: 'mine',
            indicator: buildIndicator(overrides),
            settings: { periodBars: 20 },
            warmupBarCount,
        },
        draft,
    );
}

describe('what the host stamps onto a draft', () => {
    it('takes the name from the reading rather than from anything it returned', () => {
        // A name written twice can disagree with itself.
        const plan = stamp({ series: [] });

        expect(plan.label).toBe('A phrase, not a key');
        expect(plan.indicatorId).toBe('mine');
    });

    it('takes the axis from the declaration when the draft named none', () => {
        const plan = stamp({ series: [] }, { scale: { kind: 'fixed', low: 0, high: 100 } });

        expect(plan.scale).toEqual({ kind: 'fixed', low: 0, high: 100 });
    });

    it('lets a draft name an axis of its own, for a reading whose axis is tuned', () => {
        // How much traded is a size whole and a balance split by side.
        const plan = stamp({ series: [], scale: { kind: 'symmetric' } });

        expect(plan.scale).toEqual({ kind: 'symmetric' });
    });

    it('judges convergence from the warm-up asked for against the warm-up supplied', () => {
        expect(stamp({ series: [] }, {}, 19).hasConverged).toBe(false);
        expect(stamp({ series: [] }, {}, 20).hasConverged).toBe(true);
    });

    it('lets a draft say it converged on something other than a bar count', () => {
        // An anchored mean converges when it finds its anchor, not on a count.
        const plan = stamp({ series: [], hasConverged: true }, {}, 0);

        expect(plan.hasConverged).toBe(true);
    });

    it('carries the self-colouring the reading declared, not one the draft claimed', () => {
        const claimed = stamp({ series: [] });
        const declared = stamp({ series: [] }, { isSelfColoured: true });

        expect(claimed.isSelfColoured).toBeUndefined();
        expect(declared.isSelfColoured).toBe(true);
    });
});

describe('the legend summary a draft did not write', () => {
    it('shows the figures the reader turned', () => {
        expect(stamp({ series: [] }).parameterSummary).toBe('20');
    });

    it('leaves a choice out, since it is what the reading is rather than how it is tuned', () => {
        // The source is already in the name.
        expect(summariseParameters([SOURCE], { source: 'open' })).toBe('');
    });

    it('joins several figures in declaration order', () => {
        const fast: IndicatorParameter = { ...PERIOD_BARS, name: 'fastBars' };
        const slow: IndicatorParameter = { ...PERIOD_BARS, name: 'slowBars' };

        const summary = summariseParameters([fast, SOURCE, slow], { fastBars: 12, slowBars: 26 });

        expect(summary).toBe('12 · 26');
    });

    it('says nothing for a reading with no figures to show', () => {
        expect(summariseParameters([], {})).toBe('');
    });

    it('lets a draft write its own, for knobs that are not figures', () => {
        const plan = stamp({ series: [], parameterSummary: 'daily · classic' });

        expect(plan.parameterSummary).toBe('daily · classic');
    });

    it('reads a figure through the clamp, so a stored setting cannot widen it', () => {
        const summary = summariseParameters([PERIOD_BARS], { periodBars: 10_000 });

        expect(summary).toBe('400');
    });
});

describe('what a reading is handed', () => {
    it('is given no way to learn which copy of itself is running', () => {
        // Nothing here can make the second copy compute differently from the first.
        const seen: IndicatorInput[] = [];
        const indicator = buildIndicator({
            compute: (input: IndicatorInput): PlanDraft => {
                seen.push(input);
                return { series: [] };
            },
        });

        indicator.compute({
            bars: { instrumentSymbol: 'X', intervalMs: 1, warmupBarsRequested: 0, warmupBarsReturned: 0, bars: [] },
            settings: {},
            sessions: {},
        });

        expect(Object.keys(seen[0]!).sort()).toEqual(['bars', 'sessions', 'settings']);
    });
});
