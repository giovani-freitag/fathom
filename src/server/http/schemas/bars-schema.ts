import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

const PriceBarItemSchema = Type.Object({
    openedAtMs: Type.Integer(),
    closedAtMs: Type.Integer(),
    openPrice: Type.Number(),
    highPrice: Type.Number(),
    lowPrice: Type.Number(),
    closePrice: Type.Number(),
    buyVolume: Type.Number(),
    sellVolume: Type.Number(),
    tradeCount: Type.Integer(),
    expectedFrames: Type.Integer(),
    frameCount: Type.Integer(),
    isClosed: Type.Boolean(),
    firstFrameAtMs: Type.Integer(),
    lastFrameAtMs: Type.Integer(),
});

export const BarFiltersSchema = Type.Object({
    symbol: Type.String({ minLength: 1, maxLength: 32 }),
    fromMs: Type.Integer({ minimum: 0 }),
    toMs: Type.Integer({ minimum: 0 }),
    // Bounded by the ladder the client offers, not open: an arbitrary interval
    // would make every bar a one-off that no aggregate can ever answer.
    intervalMs: Type.Integer({ minimum: 1_000, maximum: 86_400_000 }),
    warmupBars: Type.Integer({ minimum: 0, maximum: 2_000, default: 0 }),
});

export type BarFilters = Static<typeof BarFiltersSchema>;

export const BarsResponseSchema = Type.Object({
    instrumentSymbol: Type.String(),
    intervalMs: Type.Integer(),
    warmupBarsRequested: Type.Integer(),
    warmupBarsReturned: Type.Integer(),
    bars: Type.Array(PriceBarItemSchema),
});

export const BarsRouteSchema = {
    querystring: BarFiltersSchema,
    response: { 200: BarsResponseSchema },
};
