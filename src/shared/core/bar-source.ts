import type { ChoiceParameter, IndicatorSettings } from './draw-plan.ts';
import type { PriceBar } from './price-bar.ts';
import { readChoice } from './draw-plan.ts';

/**
 * Which figure of a bar an indicator is run over.
 *
 * The closing price is what most readings mean by "the price", but not all of
 * them: a channel drawn on the midpoint of each bar sits differently from one
 * drawn on where trading happened to stop.
 */
export const BAR_SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'] as const;

export type BarSource = typeof BAR_SOURCES[number];

export const SOURCE: ChoiceParameter = {
    name: 'source',
    kind: 'choice',
    defaultValue: 'close',
    choices: BAR_SOURCES,
};

/**
 * The figure a bar contributes under a chosen source.
 *
 * @param bar - The bar to read.
 * @param source - Which figure, or which blend of them.
 * @returns The value the indicator sees.
 */
export function readBarSource(bar: PriceBar, source: BarSource): number {
    switch (source) {
        case 'open':
            return bar.openPrice;
        case 'high':
            return bar.highPrice;
        case 'low':
            return bar.lowPrice;
        case 'hl2':
            return (bar.highPrice + bar.lowPrice) / 2;
        case 'hlc3':
            return (bar.highPrice + bar.lowPrice + bar.closePrice) / 3;
        case 'ohlc4':
            return (bar.openPrice + bar.highPrice + bar.lowPrice + bar.closePrice) / 4;
        case 'close':
            return bar.closePrice;
    }
}

/**
 * The chosen source of every bar in a window.
 *
 * @param bars - The window, oldest first.
 * @param settings - The reader's parameter values.
 * @returns One figure per bar, in order.
 */
export function collectSource(
    bars: readonly PriceBar[],
    settings: IndicatorSettings,
): Float64Array {
    const source = readChoice(settings, SOURCE) as BarSource;
    return Float64Array.from(bars, (bar) => readBarSource(bar, source));
}
