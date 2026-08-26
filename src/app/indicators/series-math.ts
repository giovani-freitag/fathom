import type { PriceBar } from '../../shared/core/price-bar.ts';

/** A stretch of bars with no unrecorded time inside it. Half-open. */
export interface BarSegment {
    readonly startIndex: number;
    readonly endIndex: number;
}

/**
 * Splits bars into stretches that were recorded without interruption.
 *
 * Every indicator restarts at a boundary rather than carrying state across it.
 * Smoothing over a hole invents a trend through time nobody observed, and the
 * result is indistinguishable from a real one once it is a line on a screen.
 *
 * @param bars - The window, oldest first.
 * @returns The stretches, in order.
 */
export function findContinuousSegments(bars: readonly PriceBar[]): BarSegment[] {
    const segments: BarSegment[] = [];
    let startIndex = 0;

    for (let index = 1; index <= bars.length; index += 1) {
        const isBreak = index === bars.length
            || bars[index]!.openedAtMs !== bars[index - 1]!.closedAtMs;
        if (isBreak) {
            segments.push({ startIndex, endIndex: index });
            startIndex = index;
        }
    }

    return bars.length === 0 ? [] : segments;
}

/**
 * The instant each bar is plotted at.
 *
 * @param bars - The window, oldest first.
 * @returns Close instants, ascending.
 */
export function collectInstants(bars: readonly PriceBar[]): Float64Array {
    const atMs = new Float64Array(bars.length);
    for (let index = 0; index < bars.length; index += 1) {
        atMs[index] = bars[index]!.closedAtMs;
    }
    return atMs;
}

/**
 * An array of the given length with nothing said anywhere.
 *
 * @param length - How many vertices.
 * @returns All NaN, so an untouched position breaks the line.
 */
export function createBlankValues(length: number): Float64Array {
    return new Float64Array(length).fill(Number.NaN);
}

/**
 * Wilder's smoothing step.
 *
 * @param previous - The running average.
 * @param sample - The new observation.
 * @param periodBars - The period the average is over.
 * @returns The updated average.
 */
export function smoothWilder(previous: number, sample: number, periodBars: number): number {
    return previous + (sample - previous) / periodBars;
}

/**
 * The exponential smoothing weight for a period.
 *
 * @param periodBars - Bars the average spans.
 * @returns The weight given to each new sample.
 */
export function resolveExponentialWeight(periodBars: number): number {
    return 2 / (periodBars + 1);
}

/**
 * The mean of a slice.
 *
 * @param values - Source values.
 * @param fromIndex - First index, inclusive.
 * @param toIndex - Last index, inclusive.
 * @returns The arithmetic mean.
 */
export function meanOf(values: readonly number[], fromIndex: number, toIndex: number): number {
    let total = 0;
    for (let index = fromIndex; index <= toIndex; index += 1) {
        total += values[index]!;
    }
    return total / (toIndex - fromIndex + 1);
}
