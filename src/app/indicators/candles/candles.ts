import {
    type ChoiceParameter,
    type FieldLayer,
    type IndicatorSettings,
    readChoice,
} from '../../../shared/core/draw-plan.ts';

/**
 * How the price is drawn.
 *
 * The same four figures every way: what changes is which of them the eye is
 * given first. A candle leads with the body, a bar with the two ticks, and a
 * line with nothing but the close — which is what a reader wants when the shape
 * of the move matters more than any single bar in it.
 */
export const CANDLE_STYLES = ['candles', 'hollow', 'bars', 'line', 'area'] as const;

export type CandleStyle = typeof CANDLE_STYLES[number];

const STYLE: ChoiceParameter = {
    name: 'candleStyle',
    kind: 'choice',
    defaultValue: 'candles',
    choices: [...CANDLE_STYLES],
};

/**
 * The price itself, drawn as bars.
 *
 * Apart from the book because a chart of the price with nothing else on it is a
 * thing somebody wants, and because a bar is fetched whether or not any book
 * was ever recorded.
 */
export const CANDLES_LAYER: FieldLayer = {
    id: 'candles',
    labelKey: 'layer.candles',
    parameters: [STYLE],
};

/** What the price track amounts to for the part that draws it. */
export interface CandleSettings {
    readonly isCandleOverlayVisible: boolean;
    readonly candleStyle: CandleStyle;
}

/**
 * Reads the price track out of the settings the copy on the chart carries.
 *
 * @param settings - What the reader tuned, or undefined when it is not drawn.
 * @returns Whether it is drawn, and how.
 */
export function readCandleSettings(settings: IndicatorSettings | undefined): CandleSettings {
    return {
        isCandleOverlayVisible: settings !== undefined,
        candleStyle: readChoice(settings ?? {}, STYLE) as CandleStyle,
    };
}
