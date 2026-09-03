import {
    type ChoiceParameter,
    type PlanDraft,
    type HigherBarRequest,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type IndicatorSettings,
    type PlotScale,
    type PlotSeries,
    readChoice,
} from '../../../shared/core/draw-plan.ts';
import { collectInstants, createBlankValues } from '../shared/series-math.ts';
import { holdLastClosed } from '../shared/higher-timeframe.ts';
import type { PriceBar } from '../../../shared/core/price-bar.ts';

const DAY_MS = 86_400_000;
const WEEK_MS = 604_800_000;

/** Coarse bars fetched before the window: the one in force, and one spare. */
const HIGHER_WARMUP_BARS = 2;

const PERIOD: ChoiceParameter = {
    name: 'pivotPeriod',
    kind: 'choice',
    defaultValue: 'daily',
    choices: ['daily', 'weekly'],
};

/**
 * How far apart the levels are spaced above and below the centre.
 *
 * Classic spaces them by reflecting the previous range through the centre;
 * Fibonacci spaces them by fractions of it. They agree on the centre and on
 * nothing else, and readers who use one do not use the other.
 */
const FORMULA: ChoiceParameter = {
    name: 'pivotFormula',
    kind: 'choice',
    defaultValue: 'classic',
    choices: ['classic', 'fibonacci'],
};

/** The seven prices one settled coarse bar dictates. */
interface PivotSet {
    readonly central: number;
    readonly resistances: readonly [number, number, number];
    readonly supports: readonly [number, number, number];
}

/**
 * Levels the previous session agreed on, drawn across this one.
 *
 * The oldest reading on any floor: take what a session traded through, and the
 * prices it is likely to stall at next session fall out of the arithmetic. What
 * makes it worth having on a book chart is that it is the one reading here
 * computed from a rung other than the one being drawn — a level that does not
 * move all day is a level every reader on the instrument is looking at, and the
 * heat map shows what they left resting there.
 */
export class PivotPoints implements Indicator {
    readonly label = 'indicator.pivots';
    readonly about = 'indicator.pivots.help';
    readonly scale: PlotScale = { kind: 'price' };
    // Above the centre and below it are different claims, so a copy tinted to
    // one colour would draw support and resistance alike.
    readonly isSelfColoured = true;
    readonly parameters: readonly IndicatorParameter[] = [PERIOD, FORMULA];

    /**
     * Bars needed before the drawn window.
     *
     * @returns None: what this reads is on another rung entirely.
     */
    resolveWarmupBars(): number {
        return 0;
    }

    /**
     * The coarser rung this is computed from.
     *
     * @param settings - The reader's parameter values.
     * @returns The one rung, with enough before the window to have a settled bar at its left edge.
     */
    resolveHigherIntervals(settings: IndicatorSettings): readonly HigherBarRequest[] {
        return [{ intervalMs: resolvePeriodMs(settings), warmupBars: HIGHER_WARMUP_BARS }];
    }

    /**
     * Spreads each settled session's levels across the bars that followed it.
     *
     * @param input - The drawn bars, the coarser rung, and the parameters.
     * @returns Seven stepped lines, blank until a session has closed.
     */
    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const higher = input.higher.at(resolvePeriodMs(input.settings));
        const held = holdLastClosed(bars, higher?.bars ?? []);
        const isFibonacci = readChoice(input.settings, FORMULA) === 'fibonacci';

        const lines = Array.from({ length: 7 }, () => createBlankValues(bars.length));
        let previous: PriceBar | undefined;
        let didDrawAny = false;

        for (const [index, settled] of held.entries()) {
            // A bar the session turned over on is left blank, so the lines break
            // between sessions instead of drawing a ramp from one to the next.
            const isTurnover = index > 0 && settled !== previous;
            previous = settled;
            if (settled === undefined || isTurnover) {
                continue;
            }
            const set = isFibonacci ? spaceByFibonacci(settled) : spaceByReflection(settled);
            for (const [line, value] of collectLevels(set).entries()) {
                lines[line]![index] = value;
            }
            didDrawAny = true;
        }

        const atMs = collectInstants(bars);
        return {
            parameterSummary: `${readChoice(input.settings, PERIOD)} · ${readChoice(input.settings, FORMULA)}`,
            // Seven lines in three colours, two of them necessarily alike.
            // Unnamed they say "some above and some below", where the
            // reading is that price is testing R2 rather than R3.
            namesItsSeries: true,
            series: LINE_LABELS.map((label, line): PlotSeries => ({
                label,
                tone: LINE_TONES[line]!,
                shape: 'line',
                atMs,
                value: lines[line]!,
            })),
            // Blank throughout is what a window before the first close draws,
            // and a reader has to be told that rather than shown empty axes.
            hasConverged: didDrawAny,
        };
    }
}

const LINE_LABELS = [
    'indicator.pivots.central',
    'indicator.pivots.r1',
    'indicator.pivots.r2',
    'indicator.pivots.r3',
    'indicator.pivots.s1',
    'indicator.pivots.s2',
    'indicator.pivots.s3',
] as const;

const LINE_TONES = ['amber', 'ask', 'ask', 'ask', 'bid', 'bid', 'bid'] as const;

/** Fractions of the previous range the Fibonacci spacing puts its levels at. */
const FIBONACCI_STEPS = [0.382, 0.618, 1] as const;

/**
 * The rung a chosen period is asked for on.
 *
 * @param settings - The reader's parameter values.
 * @returns The interval in milliseconds.
 */
function resolvePeriodMs(settings: IndicatorSettings): number {
    return readChoice(settings, PERIOD) === 'weekly' ? WEEK_MS : DAY_MS;
}

/**
 * The centre price a session is summarised by.
 *
 * @param bar - The settled session.
 * @returns Its high, low and close averaged.
 */
function findCentre(bar: PriceBar): number {
    return (bar.highPrice + bar.lowPrice + bar.closePrice) / 3;
}

/**
 * Levels spaced by reflecting the session's extremes through its centre.
 *
 * @param bar - The settled session.
 * @returns The seven prices.
 */
function spaceByReflection(bar: PriceBar): PivotSet {
    const central = findCentre(bar);
    const range = bar.highPrice - bar.lowPrice;
    return {
        central,
        resistances: [
            2 * central - bar.lowPrice,
            central + range,
            bar.highPrice + 2 * (central - bar.lowPrice),
        ],
        supports: [
            2 * central - bar.highPrice,
            central - range,
            bar.lowPrice - 2 * (bar.highPrice - central),
        ],
    };
}

/**
 * Levels spaced by fractions of the session's range.
 *
 * @param bar - The settled session.
 * @returns The seven prices.
 */
function spaceByFibonacci(bar: PriceBar): PivotSet {
    const central = findCentre(bar);
    const range = bar.highPrice - bar.lowPrice;
    const [near, middle, far] = FIBONACCI_STEPS;
    return {
        central,
        resistances: [central + near * range, central + middle * range, central + far * range],
        supports: [central - near * range, central - middle * range, central - far * range],
    };
}

/**
 * A pivot set in the order the lines are drawn.
 *
 * @param set - The seven prices.
 * @returns Centre first, then the resistances, then the supports.
 */
function collectLevels(set: PivotSet): readonly number[] {
    return [set.central, ...set.resistances, ...set.supports];
}

export const PIVOT_POINTS = new PivotPoints();
