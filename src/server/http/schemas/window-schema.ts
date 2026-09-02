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
/**
 * The most a price may be before it stops being one.
 *
 * A trillion is far above anything a venue has ever quoted and far below the
 * largest number a caller can spell, which is the number that actually turns
 * up here: a client with no band of its own reaches for one, and asking the
 * archive to lay out every row beneath it fails inside the read rather than at
 * the door. A bad request should be answered as one.
 */
const HIGHEST_ASKABLE_PRICE = 1e12;

export const WindowFiltersSchema = Type.Object({
    symbol: Type.String({ minLength: 1, maxLength: 32 }),
    fromMs: Type.Integer({ minimum: 0 }),
    toMs: Type.Integer({ minimum: 0 }),
    maxColumns: Type.Integer({
        minimum: 1,
        maximum: MAXIMUM_FRAMES_PER_WINDOW,
        default: DEFAULT_FRAMES_PER_WINDOW,
    }),
    lowPrice: Type.Optional(Type.Number({ minimum: 0, maximum: HIGHEST_ASKABLE_PRICE })),
    highPrice: Type.Optional(Type.Number({ minimum: 0, maximum: HIGHEST_ASKABLE_PRICE })),
    maxRows: Type.Optional(Type.Integer({ minimum: 1, maximum: MAXIMUM_ROWS_PER_WINDOW })),
});

export type WindowFilters = Static<typeof WindowFiltersSchema>;

