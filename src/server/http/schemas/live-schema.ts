import { type Static, Type } from '@sinclair/typebox';

export const LiveFiltersSchema = Type.Object({
    symbol: Type.String({ minLength: 1, maxLength: 32 }),
    /** Newest frame the client already holds; the tail resumes strictly after it. */
    afterMs: Type.Integer({ minimum: 0, default: 0 }),
    /**
     * The prices on screen, so the tail carries only those.
     *
     * Prices without a row budget, deliberately. Folded to a budget the tail
     * would answer on a grid of its own choosing, and a grid the window it
     * extends does not divide into cannot be laid on that window at all.
     */
    lowPrice: Type.Optional(Type.Number({ minimum: 0 })),
    highPrice: Type.Optional(Type.Number({ minimum: 0 })),
});

export type LiveFilters = Static<typeof LiveFiltersSchema>;

export const LiveRouteSchema = {
    querystring: LiveFiltersSchema,
};
