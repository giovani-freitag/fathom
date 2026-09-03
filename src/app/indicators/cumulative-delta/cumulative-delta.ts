import {
    type PlanDraft,
    type Indicator,
    type IndicatorInput,
    type IndicatorParameter,
    type PlotScale,
} from '../../../shared/core/draw-plan.ts';
import { collectInstants, createBlankValues, findContinuousSegments } from '../shared/series-math.ts';

/**
 * What the aggressors did, added up.
 *
 * Every bar carries what was bought and what was sold *at market* — the venue
 * reports which side crossed the spread — so the difference is the net size
 * that demanded immediacy in that bar, and the running total is the net size
 * that has demanded it since the left edge.
 *
 * It is the one reading here that answers the question the heat map cannot: the
 * map shows the liquidity that was resting, and this shows who was eating it.
 * Price rising while this falls is a rally nobody was buying into.
 *
 * Counted from the left edge of the window rather than from a session open. The
 * shape is what is read — where it agrees with price and where it does not —
 * and anchoring it to a session would cost a day of warm-up bars to draw a
 * minute of chart.
 */
export class CumulativeDelta implements Indicator {
    readonly label = 'indicator.cvd';
    readonly about = 'indicator.cvd.help';
    readonly scale: PlotScale = { kind: 'auto' };
    readonly parameters: readonly IndicatorParameter[] = [];

    /**
     * Bars needed before the window for the first drawn value to be true.
     *
     * @returns None: the total starts where the window does, by design.
     */
    resolveWarmupBars(): number {
        return 0;
    }

    /**
     * Adds up the difference between what was bought and what was sold.
     *
     * @param input - The bars and the parameters.
     * @returns One line, running from nought at the first bar drawn.
     */
    compute(input: IndicatorInput): PlanDraft {
        const bars = input.bars.bars;
        const value = createBlankValues(bars.length);

        // Restarted across a hole rather than carried over it: adding what
        // traded either side of an unrecorded stretch would draw a step nobody
        // traded.
        for (const segment of findContinuousSegments(bars)) {
            let runningTotal = 0;
            for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
                const bar = bars[index]!;
                runningTotal += bar.buyVolume - bar.sellVolume;
                value[index] = runningTotal;
            }
        }

        return {
            series: [{
                label: this.label,
                tone: 'ink',
                shape: 'line',
                atMs: collectInstants(bars),
                value,
            }],
            // Where it crosses is where the aggression changed hands, which is
            // the line a reader looks for first.
            levels: [{ value: 0, tone: 'muted', isDashed: true }],
        };
    }
}

export const CUMULATIVE_DELTA = new CumulativeDelta();
