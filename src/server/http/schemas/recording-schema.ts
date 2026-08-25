import { Type } from '@sinclair/typebox';

const RecordedInstrumentSchema = Type.Object({
    instrumentSymbol: Type.String(),
    priceBucketSize: Type.Number(),
    frameIntervalMs: Type.Integer(),
    isEnabled: Type.Boolean(),
});

export const RecordingResponseSchema = Type.Object({
    instruments: Type.Array(RecordedInstrumentSchema),
    maximumBytes: Type.Integer(),
    usedBytes: Type.Integer(),
});

export const RecordingRouteSchema = {
    response: { 200: RecordingResponseSchema },
};

export const InstrumentUpdateSchema = Type.Object({
    instrumentSymbol: Type.String({ minLength: 1, maxLength: 32 }),
    priceBucketSize: Type.Number({ exclusiveMinimum: 0 }),
    frameIntervalMs: Type.Integer({ minimum: 100, maximum: 3_600_000 }),
    isEnabled: Type.Boolean(),
});

export const InstrumentUpdateRouteSchema = {
    body: InstrumentUpdateSchema,
    response: { 200: RecordingResponseSchema },
};

// A gigabyte floor: a smaller ceiling would drop every partition the moment it
// was set, and a control that erases the archive in one click is not a control.
export const BudgetUpdateSchema = Type.Object({
    maximumBytes: Type.Integer({ minimum: 1_073_741_824 }),
});

export const BudgetUpdateRouteSchema = {
    body: BudgetUpdateSchema,
    response: { 200: RecordingResponseSchema },
};
