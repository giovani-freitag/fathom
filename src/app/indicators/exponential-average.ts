import type { DrawPlan, Indicator, IndicatorInput } from '../../shared/core/draw-plan.ts';

export interface ExponentialAverageConfig {
    /** Bars the average is smoothed over. */
    readonly periodBars: number;
}

/**
 * Bars of warm-up an average of this period needs before it has converged.
 *
 * At a smoothing factor of 2/(n+1), the seed still carries 13.5% of the weight
 * after n bars. Two and a bit periods brings that under a percent, which is the
 * point at which a reader comparing two screens stops seeing a difference.
 */
export function resolveWarmupBars(periodBars: number): number {
    return Math.max(1, Math.ceil(periodBars * 2.3));
}

/**
 * The exponential moving average of the bar close.
 */
export class ExponentialAverage implements Indicator {
    readonly id: string;
    readonly warmupBars: number;

    private readonly periodBars: number;

    constructor(config: ExponentialAverageConfig) {
        this.periodBars = Math.max(1, Math.floor(config.periodBars));
        this.id = `ema-${this.periodBars}`;
        this.warmupBars = resolveWarmupBars(this.periodBars);
    }

    /**
     * Smooths the closes of a window into one line.
     *
     * @param input - The bars, and how many of them are warm-up.
     * @returns One line, breaking wherever a bucket is missing.
     */
    compute(input: IndicatorInput): DrawPlan {
        const bars = input.bars.bars;
        const atMs = new Float64Array(bars.length);
        const value = new Float64Array(bars.length);
        const weight = 2 / (this.periodBars + 1);
        let average = Number.NaN;

        for (let index = 0; index < bars.length; index += 1) {
            const bar = bars[index]!;
            atMs[index] = bar.closedAtMs;
            // A hole in the recording restarts the average rather than carrying
            // one across time nobody saw. Smoothing over a gap invents a trend.
            const isContinuous = index === 0 || bar.openedAtMs === bars[index - 1]!.closedAtMs;
            average = Number.isNaN(average) || !isContinuous
                ? bar.closePrice
                : average + weight * (bar.closePrice - average);
            value[index] = average;
        }

        return {
            series: [{ label: this.id.toUpperCase(), tone: 'phosphor', shape: 'line', atMs, value }],
            hasConverged: input.warmupBarCount >= this.warmupBars,
        };
    }
}
