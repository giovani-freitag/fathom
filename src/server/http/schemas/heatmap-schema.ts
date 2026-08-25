import { WindowFiltersSchema } from './window-schema.ts';

/**
 * Depth frames answer as a binary window rather than JSON.
 */
export const HeatmapRouteSchema = {
    querystring: WindowFiltersSchema,
};
