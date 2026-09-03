import type { PriceBar } from './price-bar.ts';

/** A stretch of bars with no unrecorded time inside it. Half-open. */
export interface BarSegment {
    readonly startIndex: number;
    readonly endIndex: number;
}

/**
 * What a smoothing pass needs, as one thing rather than five.
 *
 * Named rather than positional because three of the five were numbers in a row:
 * the period, the first index and the last. Two of them transposed compiles, and
 * every average on the chart would be a little wrong with nothing to show for it.
 */
export interface SeriesFill {
    readonly source: ArrayLike<number>;
    readonly periodBars: number;
    /** The stretch to fill, which is a stretch recorded without interruption. */
    readonly segment: BarSegment;
    /** Written in place, and left untouched before the seed is complete. */
    readonly out: Float64Array;
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
 * Fills a stretch with an exponential average of a source series.
 *
 * Seeded with the simple mean of the first period rather than with the first
 * value. It is what the reference implementations do, and it is why an average
 * read off this chart and one read off another agree from the first bar either
 * of them draws rather than only after the seed has washed out.
 *
 * @param fill - The source, the period, the stretch, and where to write it.
 */
export function fillExponential(fill: SeriesFill): void {
    const { source, periodBars, out } = fill;
    const { startIndex, endIndex } = fill.segment;
    const firstIndex = findFirstReal(source, startIndex, endIndex);
    const seedIndex = firstIndex + periodBars - 1;
    if (firstIndex === -1 || seedIndex >= endIndex) {
        return;
    }

    let total = 0;
    for (let index = firstIndex; index <= seedIndex; index += 1) {
        total += source[index]!;
    }

    const weight = resolveExponentialWeight(periodBars);
    let average = total / periodBars;
    out[seedIndex] = average;
    for (let index = seedIndex + 1; index < endIndex; index += 1) {
        average += weight * (source[index]! - average);
        out[index] = average;
    }
}

/**
 * Fills a stretch with Wilder's smoothing of a source series.
 *
 * Seeded with the simple mean of the first period, which is the seed Wilder
 * defined and the one the reference implementations use.
 *
 * @param fill - The source, the period, the stretch, and where to write it.
 */
export function fillWilder(fill: SeriesFill): void {
    const { source, periodBars, out } = fill;
    const { startIndex, endIndex } = fill.segment;
    const seedIndex = startIndex + periodBars - 1;
    if (seedIndex >= endIndex) {
        return;
    }

    let total = 0;
    for (let index = startIndex; index <= seedIndex; index += 1) {
        total += source[index]!;
    }

    let average = total / periodBars;
    out[seedIndex] = average;
    for (let index = seedIndex + 1; index < endIndex; index += 1) {
        average = smoothWilder(average, source[index]!, periodBars);
        out[index] = average;
    }
}

function findFirstReal(source: ArrayLike<number>, startIndex: number, endIndex: number): number {
    for (let index = startIndex; index < endIndex; index += 1) {
        if (!Number.isNaN(source[index]!)) {
            return index;
        }
    }
    return -1;
}


/**
 * How far a bar travelled, counting the gap from where the last one closed.
 *
 * @param bar - The bar to measure.
 * @param previousClose - What the bar before it closed at.
 * @returns The true range, in quote currency.
 */
export function resolveTrueRange(bar: PriceBar, previousClose: number): number {
    return Math.max(
        bar.highPrice - bar.lowPrice,
        Math.abs(bar.highPrice - previousClose),
        Math.abs(bar.lowPrice - previousClose),
    );
}

/**
 * How far each bar of a stretch travelled.
 *
 * @param bars - The window, oldest first.
 * @param segment - The unbroken stretch to measure.
 * @returns One range per bar, blank outside the stretch.
 */
export function collectTrueRanges(bars: readonly PriceBar[], segment: BarSegment): Float64Array {
    const ranges = createBlankValues(bars.length);
    for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
        const bar = bars[index]!;
        // The first bar of a stretch has nothing behind it, so its own span is
        // the whole of what it travelled.
        ranges[index] = index === segment.startIndex
            ? bar.highPrice - bar.lowPrice
            : resolveTrueRange(bar, bars[index - 1]!.closePrice);
    }
    return ranges;
}
