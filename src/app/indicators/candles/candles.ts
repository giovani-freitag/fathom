import type { FieldLayer } from '../../../shared/core/draw-plan.ts';

/**
 * The price itself, drawn as bars.
 *
 * Apart from the book because a chart of the price with nothing else on it is a
 * thing somebody wants, and because a bar is fetched whether or not any book
 * was ever recorded.
 */
export const CANDLES_LAYER: FieldLayer = { id: 'candles', labelKey: 'layer.candles', parameters: [] };
