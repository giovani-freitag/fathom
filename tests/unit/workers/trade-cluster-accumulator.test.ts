import { describe, expect, it } from 'vitest';
import { TradeClusterAccumulator } from '../../../src/workers/core/trade-cluster-accumulator.ts';

function buildAccumulator(): TradeClusterAccumulator {
    return new TradeClusterAccumulator({ priceBucketSize: 10, frameIntervalMs: 1_000 });
}

describe('TradeClusterAccumulator', () => {
    it('folds executions in one time and price cell into a single cluster', () => {
        const accumulator = buildAccumulator();

        accumulator.add({ executedAtMs: 1_200, price: 1_003, quantity: 2, isAggressorSelling: false });
        accumulator.add({ executedAtMs: 1_800, price: 1_007, quantity: 3, isAggressorSelling: false });

        expect(accumulator.drainBefore(2_000)).toEqual([{
            executedAtMs: 1_000,
            priceBucketIndex: 100,
            buyQuantity: 5,
            sellQuantity: 0,
            tradeCount: 2,
            largestTradeQuantity: 3,
        }]);
    });

    it('separates the two aggressor sides inside one cell', () => {
        const accumulator = buildAccumulator();

        accumulator.add({ executedAtMs: 1_000, price: 1_000, quantity: 2, isAggressorSelling: false });
        accumulator.add({ executedAtMs: 1_500, price: 1_000, quantity: 6, isAggressorSelling: true });

        const [cluster] = accumulator.drainBefore(2_000);

        expect([cluster?.buyQuantity, cluster?.sellQuantity]).toEqual([2, 6]);
    });

    it('keeps the largest single execution rather than an average', () => {
        const accumulator = buildAccumulator();

        accumulator.add({ executedAtMs: 1_000, price: 1_000, quantity: 0.01, isAggressorSelling: false });
        accumulator.add({ executedAtMs: 1_000, price: 1_000, quantity: 40, isAggressorSelling: false });

        expect(accumulator.drainBefore(2_000)[0]?.largestTradeQuantity).toBe(40);
    });

    it('keeps cells belonging to the frame still open', () => {
        const accumulator = buildAccumulator();

        accumulator.add({ executedAtMs: 1_500, price: 1_000, quantity: 1, isAggressorSelling: false });
        accumulator.add({ executedAtMs: 2_500, price: 1_000, quantity: 1, isAggressorSelling: false });

        const drained = accumulator.drainBefore(2_000);

        expect([drained.length, accumulator.pendingCellCount]).toEqual([1, 1]);
    });

    it('returns clusters ordered by time then price', () => {
        const accumulator = buildAccumulator();

        accumulator.add({ executedAtMs: 2_000, price: 1_000, quantity: 1, isAggressorSelling: false });
        accumulator.add({ executedAtMs: 1_000, price: 1_020, quantity: 1, isAggressorSelling: false });
        accumulator.add({ executedAtMs: 1_000, price: 1_000, quantity: 1, isAggressorSelling: false });

        const drained = accumulator.drainBefore(3_000);

        expect(drained.map((cluster) => [cluster.executedAtMs, cluster.priceBucketIndex]))
            .toEqual([[1_000, 100], [1_000, 102], [2_000, 100]]);
    });

    it('empties the drained cells so a second drain returns nothing', () => {
        const accumulator = buildAccumulator();
        accumulator.add({ executedAtMs: 1_000, price: 1_000, quantity: 1, isAggressorSelling: false });

        accumulator.drainBefore(2_000);

        expect(accumulator.drainBefore(2_000)).toEqual([]);
    });
});
