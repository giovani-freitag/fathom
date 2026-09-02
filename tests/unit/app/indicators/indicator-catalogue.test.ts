import { describe, expect, it } from 'vitest';
import {
    CHART_LAYERS,
    findChartLayer,
    INDICATOR_CATALOGUE,
    readLayerDefaults,
    resolveRequiredHigherBars,
} from '../../../../src/app/indicators/indicator-catalogue.ts';
import { resolveFieldSettings } from '../../../../src/app/indicators/field-layers.ts';
import { isPlanWithinBudget, NO_HIGHER_BARS } from '../../../../src/shared/core/draw-plan.ts';
import type { Indicator } from '../../../../src/shared/core/draw-plan.ts';
import { BAR_INTERVAL_MS, buildRun, buildWindow } from '../../../mocks/price-bars.ts';

/** A run long enough that every shipped indicator has converged inside it. */
const RUN_LENGTH = 200;

function computeOver(indicator: Indicator, bars: ReturnType<typeof buildRun>) {
    return indicator.compute({
        bars: buildWindow(bars),
        warmupBarCount: 0,
        higher: NO_HIGHER_BARS,
        settings: readLayerDefaults(indicator),
    });
}

/** A wandering price, so nothing passes by being constant. */
function wander(index: number): number {
    return 100 + Math.sin(index / 7) * 12 + index * 0.3;
}

describe('every shipped indicator', () => {
    it.each(INDICATOR_CATALOGUE.map((indicator) => [indicator.id, indicator] as const))(
        '%s draws a plan the host will accept',
        (_id, indicator) => {
            const bars = buildRun(RUN_LENGTH, wander);

            const plan = computeOver(indicator, bars);

            expect(isPlanWithinBudget(plan)).toBe(true);
            expect(plan.series.every((series) => series.value.length === bars.length)).toBe(true);
        },
    );

    it.each(INDICATOR_CATALOGUE.map((indicator) => [indicator.id, indicator] as const))(
        '%s reads nothing across a hole in the recording',
        (_id, indicator) => {
            // The strongest statement of the rule: what is drawn after a gap must
            // be exactly what would be drawn if the bars before it had never
            // existed. Anything else is a reading of time nobody recorded.
            const after = buildRun(RUN_LENGTH, wander, 10_000);
            const across = [...buildRun(RUN_LENGTH, wander), ...after];

            const whole = computeOver(indicator, across);
            const alone = computeOver(indicator, after);

            const tail = whole.series.map((series) => [...series.value.slice(RUN_LENGTH)]);
            expect(tail).toEqual(alone.series.map((series) => [...series.value]));
        },
    );

    it.each(
        INDICATOR_CATALOGUE
            .filter((indicator) => indicator.scale.kind === 'fixed')
            .map((indicator) => [indicator.id, indicator] as const),
    )('%s stays inside the bounds it declared', (_id, indicator) => {
        const scale = indicator.scale as { low: number; high: number };

        const plan = computeOver(indicator, buildRun(RUN_LENGTH, wander));

        const values = plan.series.flatMap((series) => [...series.value]).filter(Number.isFinite);
        expect(Math.min(...values)).toBeGreaterThanOrEqual(scale.low);
        expect(Math.max(...values)).toBeLessThanOrEqual(scale.high);
    });

    it.each(INDICATOR_CATALOGUE.map((indicator) => [indicator.id, indicator] as const))(
        '%s clamps a setting from outside its declared range',
        (_id, indicator) => {
            // Settings survive in storage past the control that produced them, so
            // a figure no current control can produce still has to arrive safely.
            const wild = Object.fromEntries(
                indicator.parameters.map((parameter) => [parameter.name, -1_000]),
            );

            const plan = indicator.compute({
                bars: buildWindow(buildRun(RUN_LENGTH, wander)),
                warmupBarCount: 0,
                higher: NO_HIGHER_BARS,
                settings: wild,
            });

            const values = plan.series.flatMap((series) => [...series.value]);
            expect(values.every((value) => Number.isNaN(value) || Number.isFinite(value))).toBe(true);
        },
    );

    it('offers every indicator under an id of its own', () => {
        const ids = INDICATOR_CATALOGUE.map((indicator) => indicator.id);

        expect(new Set(ids).size).toBe(ids.length);
    });

    it('plots against the same instants the bars closed at', () => {
        const bars = buildRun(20, wander);

        const plan = computeOver(INDICATOR_CATALOGUE[0]!, bars);

        expect(plan.series[0]?.atMs[0]).toBe(bars[0]!.openedAtMs + BAR_INTERVAL_MS);
    });
});

describe('what a reader can put on the chart', () => {
    it('offers the host layers beside the indicators, in one list', () => {
        // Choosing what to look at is one decision. The two halves differ in how
        // they are drawn, which is the host's problem rather than the reader's.
        const offered = CHART_LAYERS.map((layer) => layer.id);

        expect(offered.slice(0, 2)).toEqual(['depth', 'candles']);
        expect(offered).toContain('rsi');
    });

    it('finds either half under the id a stored selection names', () => {
        expect(findChartLayer('depth')?.id).toBe('depth');
        expect(findChartLayer('rsi')?.id).toBe('rsi');
        expect(findChartLayer('nothing-like-that')).toBeNull();
    });

    it('leaves a plain price chart when the book is not drawn', () => {
        const settings = resolveFieldSettings([
            { instanceId: 'candles-1', indicatorId: 'candles', settings: {}, tone: 'ink' },
        ]);

        expect(settings.isDepthVisible).toBe(false);
        expect(settings.isCandleOverlayVisible).toBe(true);
    });

    it('carries the gap marks on the book too, which is what a gap is a hole in', () => {
        const settings = resolveFieldSettings([
            {
                instanceId: 'depth-1',
                indicatorId: 'depth',
                settings: { showGaps: false },
                tone: 'muted',
            },
        ]);

        expect(settings.areGapsVisible).toBe(false);
    });

    it('marks them by default, so a reader who has not looked is never shown a smooth line', () => {
        const settings = resolveFieldSettings([
            { instanceId: 'depth-1', indicatorId: 'depth', settings: {}, tone: 'muted' },
        ]);

        expect(settings.areGapsVisible).toBe(true);
    });

    it('stops marking them with the book, which is the recording they are gaps in', () => {
        const settings = resolveFieldSettings([
            { instanceId: 'candles-1', indicatorId: 'candles', settings: {}, tone: 'ink' },
        ]);

        expect(settings.areGapsVisible).toBe(false);
    });

    it('carries every reading of the book on the book itself', () => {
        // Executions and the profile are the recording seen other ways. They are
        // switches on the layer that draws it, not rows of their own beside it.
        const settings = resolveFieldSettings([
            {
                instanceId: 'depth-1',
                indicatorId: 'depth',
                settings: { showExecutions: false, showProfile: true },
                tone: 'muted',
            },
        ]);

        expect(settings.isTradeOverlayVisible).toBe(false);
        expect(settings.isVolumeProfileVisible).toBe(true);
    });

    it('leaves how much traded off the book, since a bar carries its own', () => {
        // Volume is drawn from the bars the candles are drawn from, so it is an
        // indicator of its own and survives a chart with no book on it.
        const book = CHART_LAYERS.find((layer) => layer.id === 'depth');

        expect(book?.parameters.map((parameter) => parameter.name)).not.toContain('showVolume');
        expect(INDICATOR_CATALOGUE.map((indicator) => indicator.id)).toContain('volume');
    });

    it('draws none of them once the book itself is not drawn', () => {
        // They read the recording the book draws; without it they are readings
        // of nothing.
        const settings = resolveFieldSettings([
            { instanceId: 'depth-1', indicatorId: 'depth', settings: {}, tone: 'muted', isHidden: true },
        ]);

        expect(settings.isTradeOverlayVisible).toBe(false);
        expect(settings.isVolumeProfileVisible).toBe(false);
    });

    it('stops drawing a layer that is hidden, and keeps how it was tuned', () => {
        const settings = resolveFieldSettings([
            { instanceId: 'depth-1', indicatorId: 'depth', settings: { colourGain: 2.5 }, tone: 'ink', isHidden: true },
        ]);

        expect(settings.isDepthVisible).toBe(false);
    });

    it('takes the depth cuts from the layer that owns them, clamped to what it declared', () => {
        const settings = resolveFieldSettings([
            { instanceId: 'depth-1', indicatorId: 'depth', settings: { colourGain: 99 }, tone: 'ink' },
        ]);

        expect(settings.colourGain).toBe(3);
    });

    it('falls back to the declared cuts when no book is on the chart', () => {
        const settings = resolveFieldSettings([]);

        expect(Number.isFinite(settings.colourGain)).toBe(true);
        expect(Number.isFinite(settings.depthFloorPercentile)).toBe(true);
    });
});

describe('the coarser rungs a chart between them reads', () => {
    /** One copy on the chart, as the reader's selection carries it. */
    function addCopy(indicatorId: string, settings: Record<string, string> = {}) {
        return { instanceId: `${indicatorId}-1`, indicatorId, settings, tone: 'ink' as const };
    }

    it('asks for nothing when nothing on the chart reads another rung', () => {
        expect(resolveRequiredHigherBars([addCopy('rsi'), addCopy('cvd')])).toEqual([]);
    });

    it('asks once for a rung two copies both read', () => {
        // Two sets of pivots anchored to the same session is one fetch. Asked
        // for per copy, adding a second would cost a round trip to draw bars
        // the first one already has.
        const wanted = resolveRequiredHigherBars([addCopy('pivots'), addCopy('pivots')]);

        expect(wanted.map((one) => one.intervalMs)).toEqual([86_400_000]);
    });

    it('keeps two rungs apart when copies disagree about the session', () => {
        const wanted = resolveRequiredHigherBars([
            addCopy('pivots'),
            addCopy('pivots', { pivotPeriod: 'weekly' }),
        ]);

        expect(wanted.map((one) => one.intervalMs)).toEqual([86_400_000, 604_800_000]);
    });

    it('carries how far back a rung has to reach, not only which rung', () => {
        // A rung fetched over the drawn window alone opens with nothing settled
        // behind it, and the reading is blank down the whole left edge.
        const wanted = resolveRequiredHigherBars([addCopy('pivots')]);

        expect(wanted).toEqual([{ intervalMs: 86_400_000, warmupBars: 2 }]);
    });

    it('ignores a stored selection naming an indicator this build dropped', () => {
        expect(resolveRequiredHigherBars([addCopy('nothing-like-that')])).toEqual([]);
    });
});
