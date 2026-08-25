import { WindowFiltersSchema } from './window-schema.ts';

/**
 * Depth frames answer as a binary window rather than JSON.
 *
 * A thousand columns of depth is a few hundred thousand quantities; as JSON that
 * is tens of megabytes of decimal text, and parsing it costs more than drawing it.
 * No response schema is declared because the body is an opaque buffer.
 */
export const HeatmapRouteSchema = {
    querystring: WindowFiltersSchema,
};
