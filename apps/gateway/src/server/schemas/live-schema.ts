import { type Static, Type } from '@sinclair/typebox';

export const LiveFiltersSchema = Type.Object({
    symbol: Type.String({ minLength: 1, maxLength: 32 }),
    /** Newest frame the client already holds; the tail resumes strictly after it. */
    afterMs: Type.Integer({ minimum: 0, default: 0 }),
});

export type LiveFilters = Static<typeof LiveFiltersSchema>;

export const LiveRouteSchema = {
    querystring: LiveFiltersSchema,
};
