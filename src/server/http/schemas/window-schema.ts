import { type Static, Type } from '@sinclair/typebox';
import {
    DEFAULT_FRAMES_PER_WINDOW,
    MAXIMUM_FRAMES_PER_WINDOW,
    MAXIMUM_ROWS_PER_WINDOW,
} from '../../../shared/core/api-contract.ts';

/**
 * Query shared by every history route: an instrument, a range, and a band.
 *
 * The band is the price half of what `maxColumns` already does for time. A
 * whole-book store answers for every price from nothing to twice the market,
 * and a reader with a screenful of them pays to receive fifteen thousand rows
 * to draw a hundred. Left out, the window still answers with everything, which
 * is what a caller that does not know its own viewport should get.
 */
export const WindowFiltersSchema = Type.Object({
    symbol: Type.String({ minLength: 1, maxLength: 32 }),
    fromMs: Type.Integer({ minimum: 0 }),
    toMs: Type.Integer({ minimum: 0 }),
    maxColumns: Type.Integer({
        minimum: 1,
        maximum: MAXIMUM_FRAMES_PER_WINDOW,
        default: DEFAULT_FRAMES_PER_WINDOW,
    }),
    lowPrice: Type.Optional(Type.Number({ minimum: 0 })),
    highPrice: Type.Optional(Type.Number({ minimum: 0 })),
    maxRows: Type.Optional(Type.Integer({ minimum: 1, maximum: MAXIMUM_ROWS_PER_WINDOW })),
});

export type WindowFilters = Static<typeof WindowFiltersSchema>;

