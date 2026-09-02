import { describe, expect, it, vi } from 'vitest';
import type { LiquidityQueryService } from '../../../src/database/services/liquidity-query-service.ts';
import { PostgresLiveTailSource } from '../../../src/server/services/postgres-live-tail-source.ts';

const BETWEEN = { symbol: 'BTCUSDT', fromMs: 1_000, toMs: 2_000 };

function buildSource() {
    const fetchTradeClusters = vi.fn().mockResolvedValue({
        priceBucketSize: 10,
        sampleIntervalMs: 1_000,
        clusters: [],
    });
    const fetchGaps = vi.fn().mockResolvedValue([]);
    const query = { fetchTradeClusters, fetchGaps } as unknown as LiquidityQueryService;
    return { fetchTradeClusters, fetchGaps, source: new PostgresLiveTailSource({ query }) };
}

describe('PostgresLiveTailSource', () => {
    it('reads the executions of a stretch ungrouped, as they were recorded', async () => {
        // A tail extends a window the chart already holds, so what it carries
        // has to be on the same grid. Grouped on the way out it would arrive
        // finer or coarser than everything beside it.
        const { fetchTradeClusters, source } = buildSource();

        await source.fetchTradeClustersBetween(BETWEEN);

        expect(fetchTradeClusters.mock.calls[0]?.[0]).toMatchObject({
            priceGroupSize: 1,
            minimumQuantity: 0,
        });
    });

    it('bounds one pass, so a long stall is not one flood', async () => {
        const { fetchTradeClusters, source } = buildSource();

        await source.fetchTradeClustersBetween(BETWEEN);

        expect((fetchTradeClusters.mock.calls[0]?.[0] as { maxColumns: number }).maxColumns)
            .toBeGreaterThan(0);
    });

    it('reads the holes of the same stretch', async () => {
        const { fetchGaps, source } = buildSource();

        await source.fetchGapsBetween(BETWEEN);

        expect(fetchGaps.mock.calls[0]?.[0]).toMatchObject({ symbol: 'BTCUSDT' });
    });

    it('answers for neither the depth nor anything a store keeps its own copy of', () => {
        // The point of it: there is one execution table and one gap ledger, so
        // a tail over any archive takes both from here and takes only the depth
        // from the archive the chart is drawn out of.
        const { source } = buildSource();

        expect('fetchFramesAfter' in source).toBe(false);
    });
});
