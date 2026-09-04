import { describe, expect, it } from 'vitest';
import { isPlanWithinBudget } from '../../../../src/shared/core/draw-plan.ts';
import { collectSessions } from '../../../../src/shared/core/settled-sessions.ts';
import { PIVOT_POINTS } from '../../../../src/app/indicators/pivot-points/pivot-points.ts';
import type { PriceBar, PriceBarWindow } from '../../../../src/shared/core/price-bar.ts';
import { buildBar, buildRun, buildWindow } from '../../../mocks/price-bars.ts';

const DAY_MS = 86_400_000;

/** A session of a declared width, so a test can close one inside a short run. */
function buildSession(
    openedAtMs: number,
    prices: { high: number; low: number; close: number },
    widthMs = DAY_MS,
): PriceBar {
    return {
        ...buildBar(openedAtMs, prices.close, { highPrice: prices.high, lowPrice: prices.low }),
        closedAtMs: openedAtMs + widthMs,
    };
}

/** The coarse window as the host hands it over. */
function buildSessions(bars: readonly PriceBar[], intervalMs = DAY_MS): PriceBarWindow {
    return { ...buildWindow(bars), intervalMs };
}

/** A day that closed before the drawn window opened. Centre 110, range 30. */
const YESTERDAY = buildSession(-DAY_MS, { high: 120, low: 90, close: 120 });

const CENTRE = (120 + 90 + 120) / 3;

function computeOver(
    sessions: readonly PriceBar[],
    settings: Record<string, string> = {},
    barCount = 3,
) {
    const bars = buildWindow(buildRun(barCount, () => 100));
    const supplied = new Map([[DAY_MS, buildSessions(sessions)]]);

    return PIVOT_POINTS.compute({
        bars,
        settings,
        sessions: collectSessions(bars.bars, supplied, PIVOT_POINTS.resolveSources(settings).sessions),
    });
}

describe('PivotPoints', () => {
    it('centres the set on what the settled session averaged', () => {
        const plan = computeOver([YESTERDAY]);

        expect(plan.series[0]!.value[0]).toBeCloseTo(CENTRE, 9);
    });

    it('reflects the session extremes through the centre for the first pair', () => {
        const plan = computeOver([YESTERDAY]);

        expect([plan.series[1]!.value[0], plan.series[4]!.value[0]])
            .toEqual([2 * CENTRE - 90, 2 * CENTRE - 120]);
    });

    it('spaces the levels by fractions of the range when asked for Fibonacci', () => {
        const plan = computeOver([YESTERDAY], { pivotFormula: 'fibonacci' });

        expect(plan.series[1]!.value[0]).toBeCloseTo(CENTRE + 0.382 * 30, 9);
    });

    it('draws the session that closed, never the one being lived through', () => {
        // The second session closes a minute into the run at a wildly different
        // level. Drawn from it before it closed, every bar of the first minute
        // would show a figure the market had not yet produced.
        const today = buildSession(0, { high: 900, low: 800, close: 900 }, 120_000);
        const plan = computeOver([YESTERDAY, today], {}, 4);

        expect(plan.series[0]!.value[0]).toBeCloseTo(CENTRE, 9);
    });

    it('takes up the newer session only once it has closed', () => {
        const today = buildSession(0, { high: 900, low: 800, close: 900 }, 120_000);
        const plan = computeOver([YESTERDAY, today], {}, 4);

        expect(plan.series[0]!.value[3]).toBeCloseTo((900 + 800 + 900) / 3, 9);
    });

    it('breaks the line where the session turned over instead of ramping to it', () => {
        // Two levels joined by a vertex draw a diagonal across the turnover,
        // which is a price the pivot never sat at.
        const today = buildSession(0, { high: 900, low: 800, close: 900 }, 120_000);
        const plan = computeOver([YESTERDAY, today], {}, 4);

        expect(plan.series[0]!.value[2]).toBeNaN();
    });

    it('draws nothing and says so before any session has closed', () => {
        const plan = computeOver([buildSession(0, { high: 120, low: 90, close: 120 })]);

        expect(plan.hasConverged).toBe(false);
    });

    it('draws nothing when the host could not fetch the rung at all', () => {
        const bars = buildWindow(buildRun(3, () => 100));

        const plan = PIVOT_POINTS.compute({
            bars,
            settings: {},
            sessions: collectSessions(bars.bars, new Map(), PIVOT_POINTS.resolveSources({}).sessions),
        });

        expect(plan.hasConverged).toBe(false);
    });

    it('asks for the daily rung, with a session in hand before the window opens', () => {
        expect(PIVOT_POINTS.resolveSources({}).sessions).toEqual({
            session: { intervalMs: DAY_MS, reachingBack: 2 },
        });
    });

    it('asks for the weekly rung instead when anchored to a week', () => {
        const declared = PIVOT_POINTS.resolveSources({ pivotPeriod: 'weekly' }).sessions;

        expect(declared?.['session']?.intervalMs).toBe(604_800_000);
    });

    it('reads the rung it asked for, not whichever one arrived', () => {
        // Handed a weekly window while set to daily, it has nothing to draw:
        // the levels a week settled on are not the levels a day settled on.
        const bars = buildWindow(buildRun(3, () => 100));
        const plan = PIVOT_POINTS.compute({
            bars,
            sessions: collectSessions(
                bars.bars,
                new Map([[604_800_000, buildSessions([YESTERDAY], 604_800_000)]]),
                PIVOT_POINTS.resolveSources({}).sessions,
            ),
            settings: {},
        });

        expect(plan.hasConverged).toBe(false);
    });

    it('draws the whole set, which the host will take', () => {
        const plan = computeOver([YESTERDAY]);

        expect([plan.series.length, isPlanWithinBudget(plan)]).toEqual([7, true]);
    });

    it('works the whole set out the way a floor would, on figures a venue published', () => {
        // BTCUSDT on 2026-09-01 as the venue served it, against the seven levels
        // worked by hand from it. The close is a millisecond short of midnight,
        // which is how a venue reports one and is what the rule has to accept.
        const openedAtMs = Date.UTC(2026, 8, 1);
        const session = {
            ...buildBar(openedAtMs, 77_400.10, { highPrice: 79_196.00, lowPrice: 76_368.00 }),
            closedAtMs: openedAtMs + DAY_MS - 1,
        };

        const bars = buildWindow([buildBar(openedAtMs + DAY_MS, 77_300)]);
        const plan = PIVOT_POINTS.compute({
            bars,
            settings: {},
            sessions: collectSessions(
                bars.bars,
                new Map([[DAY_MS, buildSessions([session])]]),
                PIVOT_POINTS.resolveSources({}).sessions,
            ),
        });

        expect(plan.series.map((one) => Number(one.value[0]!.toFixed(2)))).toEqual([
            77_654.70, 78_941.40, 80_482.70, 81_769.40, 76_113.40, 74_826.70, 73_285.40,
        ]);
    });

    it('needs nothing before the window, what it reads being on another rung', () => {
        // Warm-up buys bars of the drawn rung, and no number of minutes brings
        // a closed day any closer. The depth this needs is declared on the rung.
        expect(PIVOT_POINTS.resolveSources({}).warmupBars).toBeUndefined();
    });

    it('keeps support and resistance apart in colour when a copy is tinted', () => {
        expect(PIVOT_POINTS.isSelfColoured).toBe(true);
    });
});
