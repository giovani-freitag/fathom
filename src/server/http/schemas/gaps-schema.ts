import { Type } from '@sinclair/typebox';
import { WindowFiltersSchema } from './window-schema.ts';

const RecordingGapItemSchema = Type.Object({
    gapStartedAtMs: Type.Integer(),
    gapEndedAtMs: Type.Integer(),
    gapReason: Type.String(),
});

export const GapsResponseSchema = Type.Object({
    gaps: Type.Array(RecordingGapItemSchema),
});

export const GapsRouteSchema = {
    querystring: WindowFiltersSchema,
    response: { 200: GapsResponseSchema },
};
