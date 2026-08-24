import { Type } from '@sinclair/typebox';

const InstrumentItemSchema = Type.Object({
    instrumentSymbol: Type.String(),
    priceBucketSize: Type.Number(),
    frameIntervalMs: Type.Integer(),
    firstFrameAtMs: Type.Union([Type.Integer(), Type.Null()]),
    lastFrameAtMs: Type.Union([Type.Integer(), Type.Null()]),
});

export const InstrumentsResponseSchema = Type.Object({
    instruments: Type.Array(InstrumentItemSchema),
});

export const InstrumentsRouteSchema = {
    response: { 200: InstrumentsResponseSchema },
};
