import {
    type PlanDraft,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type IndicatorSettings,
    type NumericParameter,
    type PlotScale,
    readSetting,
} from '../../../shared/core/draw-plan.ts';
import {
    type BarSegment,
    collectInstants,
    collectTrueRanges,
    createBlankValues,
    fillWilder,
    findContinuousSegments,
} from '../shared/series-math.ts';
import type { PriceBar } from '../../../shared/core/price-bar.ts';

const PERIOD_BARS: NumericParameter = {
    name: 'periodBars',
    kind: 'integer',
    defaultValue: 14,
    minimum: 2,
    maximum: 200,
};

/** Where a trend is conventionally read as strong enough to trade with. */
const TRENDING = 25;

/**
 * How strongly the market is trending, and which way it is leaning.
 *
 * Three readings that answer different questions and are always read together.
 * The two directional lines say which side is making the running; the strength
 * line says whether either of them means anything, and it is deliberately blind
 * to direction — a hard fall and a hard rise read the same. A market can lean
 * clearly and go nowhere, which is what a wide gap under a low strength line
 * looks like.
 */
export class DirectionalMovement implements Indicator {
    readonly label = 'indicator.adx';
    readonly about = 'indicator.adx.help';
    readonly scale: PlotScale = { kind: 'fixed', low: 0, high: 100 };
    readonly isSelfColoured = true;
    readonly parameters: readonly IndicatorParameter[] = [PERIOD_BARS];

    /**
     * Bars needed before the window for both smoothings to have settled.
     *
     * @param settings - The reader's parameter values.
     * @returns The bar count, counting the strength line's second smoothing.
     */
    resolveWarmupBars(settings: IndicatorSettings): number {
        return readSetting(settings, PERIOD_BARS) * 5;
    }

    /**
     * Turns each bar's overhang into the two sides and the strength between them.
     *
     * @param input - The bars, the warm-up count, and the parameters.
     * @returns Three lines, with the conventional threshold marked.
     */
    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const periodBars = readSetting(input.settings, PERIOD_BARS);

        const upward = createBlankValues(bars.length);
        const downward = createBlankValues(bars.length);
        const strength = createBlankValues(bars.length);
        for (const segment of findContinuousSegments(bars)) {
            walkDirection({ bars, segment, periodBars, upward, downward, strength });
        }

        const atMs = collectInstants(bars);
        return {
            series: [
                { label: this.label, tone: 'ink', shape: 'line', atMs, value: strength, widthPx: 2 },
                { label: 'indicator.adx.upward', tone: 'bid', shape: 'line', atMs, value: upward },
                { label: 'indicator.adx.downward', tone: 'ask', shape: 'line', atMs, value: downward },
            ],
            levels: [{ value: TRENDING, tone: 'muted', isDashed: true }],
        };
    }
}

interface DirectionWalk {
    readonly bars: readonly PriceBar[];
    readonly segment: BarSegment;
    readonly periodBars: number;
    readonly upward: Float64Array;
    readonly downward: Float64Array;
    readonly strength: Float64Array;
}

/**
 * Smooths both sides over one stretch, then smooths their disagreement again.
 */
function walkDirection(walk: DirectionWalk): void {
    const { bars, segment, periodBars, upward, downward, strength } = walk;
    const { startIndex, endIndex } = segment;

    const upMoves = createBlankValues(bars.length);
    const downMoves = createBlankValues(bars.length);
    for (let index = startIndex; index < endIndex; index += 1) {
        const overhang = index === startIndex
            ? { up: 0, down: 0 }
            : measureOverhang(bars[index]!, bars[index - 1]!);
        upMoves[index] = overhang.up;
        downMoves[index] = overhang.down;
    }

    const smoothedUp = createBlankValues(bars.length);
    const smoothedDown = createBlankValues(bars.length);
    const smoothedRange = createBlankValues(bars.length);
    fillWilder({ source: upMoves, periodBars, segment, out: smoothedUp });
    fillWilder({ source: downMoves, periodBars, segment, out: smoothedDown });
    fillWilder({ source: collectTrueRanges(bars, segment), periodBars, segment, out: smoothedRange });

    const disagreement = createBlankValues(bars.length);
    for (let index = startIndex; index < endIndex; index += 1) {
        const range = smoothedRange[index]!;
        if (Number.isNaN(range) || range === 0) {
            continue;
        }
        const up = 100 * smoothedUp[index]! / range;
        const down = 100 * smoothedDown[index]! / range;
        upward[index] = up;
        downward[index] = down;
        disagreement[index] = up + down === 0 ? 0 : 100 * Math.abs(up - down) / (up + down);
    }

    // The strength line smooths the disagreement a second time, over the stretch
    // that actually has one: seeding it where the first smoothing had not
    // settled would average in a number that was never a reading.
    const settledFrom = startIndex + periodBars - 1;
    if (settledFrom < endIndex) {
        fillWilder({
            source: disagreement,
            periodBars,
            segment: { startIndex: settledFrom, endIndex },
            out: strength,
        });
    }
}

/**
 * How far this bar reached past the last one, on whichever side reached further.
 *
 * A bar that overhangs on both sides is inside neither trend and counts for
 * neither: only the larger overhang is a directional move at all.
 */
function measureOverhang(bar: PriceBar, previous: PriceBar): { up: number; down: number } {
    const up = bar.highPrice - previous.highPrice;
    const down = previous.lowPrice - bar.lowPrice;
    return {
        up: up > down && up > 0 ? up : 0,
        down: down > up && down > 0 ? down : 0,
    };
}

export const DIRECTIONAL_MOVEMENT = new DirectionalMovement();
