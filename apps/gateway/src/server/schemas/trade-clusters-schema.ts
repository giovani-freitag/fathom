import { type Static, Type } from '@sinclair/typebox';
import { WindowFiltersSchema } from './window-schema.ts';

const TradeClusterItemSchema = Type.Object({
    executedAtMs: Type.Integer(),
    priceBucketIndex: Type.Integer(),
    buyQuantity: Type.Number(),
    sellQuantity: Type.Number(),
    tradeCount: Type.Integer(),
    largestTradeQuantity: Type.Number(),
});

export const TradeClustersFiltersSchema = Type.Intersect([
    WindowFiltersSchema,
    Type.Object({
        priceGroupSize: Type.Integer({ minimum: 1, maximum: 10_000, default: 1 }),
        minimumQuantity: Type.Number({ minimum: 0, default: 0 }),
    }),
]);

export type TradeClustersFilters = Static<typeof TradeClustersFiltersSchema>;

export const TradeClustersResponseSchema = Type.Object({
    priceBucketSize: Type.Number(),
    sampleIntervalMs: Type.Integer(),
    clusters: Type.Array(TradeClusterItemSchema),
});

export const TradeClustersRouteSchema = {
    querystring: TradeClustersFiltersSchema,
    response: { 200: TradeClustersResponseSchema },
};
