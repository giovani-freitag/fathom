import { Type } from '@sinclair/typebox';
import { WindowFiltersSchema } from './window-schema.ts';

/**
 * Depth frames answer as a binary window rather than JSON.
 *
 * The source names a store: the same window read out of the frame table
 * or out of the chunked archive, so the two can be compared on one chart.
 */
export const HeatmapRouteSchema = {
    querystring: Type.Intersect([
        WindowFiltersSchema,
        Type.Object({
            source: Type.Optional(Type.Union([
                Type.Literal('frames'), Type.Literal('chunks'),
            ])),
        }),
    ]),
};
