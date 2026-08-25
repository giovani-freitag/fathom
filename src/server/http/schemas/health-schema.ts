import { Type } from '@sinclair/typebox';

export const HealthResponseSchema = Type.Object({
    isDatabaseReachable: Type.Boolean(),
    serverTimeMs: Type.Integer(),
});

export const HealthRouteSchema = {
    response: { 200: HealthResponseSchema },
};
