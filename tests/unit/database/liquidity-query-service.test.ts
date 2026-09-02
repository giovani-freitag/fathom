import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChunkCoverage, ChunkRowStore } from '../../../src/database/core/chunk-row-store.ts';
import { LiquidityQueryService } from '../../../src/database/services/liquidity-query-service.ts';
import type { PostgresService } from '../../../src/database/postgres/postgres-service.ts';

const REGISTRY_ROW = {
    instrument_symbol: 'BTCUSDT',
    price_bucket_size: 10,
    frame_interval_ms: 1_000,
};

const COVERAGE: ChunkCoverage = {
    firstFrameAtMs: 1_000_000,
    lastFrameAtMs: 1_600_000,
    lastMidPrice: 78_500,
};

interface Asked {
    readonly statement: string;
    readonly values: readonly unknown[];
}

describe('LiquidityQueryService', () => {
    let asked: Asked[];
    let readCoverage: ReturnType<typeof vi.fn>;
    let service: LiquidityQueryService;

    beforeEach(() => {
        asked = [];
        const selectRows = vi.fn((statement: string, values: readonly unknown[]) => {
            asked.push({ statement, values });
            return Promise.resolve(statement.includes('instrument_registry') ? [REGISTRY_ROW] : []);
        });
        readCoverage = vi.fn().mockResolvedValue(COVERAGE);
        service = new LiquidityQueryService({
            postgres: { selectRows } as unknown as PostgresService,
            chunks: { readCoverage } as unknown as ChunkRowStore,
        });
    });

    /** The statement the read is actually about, past any lookup before it. */
    function theQuery(): Asked {
        return asked[asked.length - 1]!;
    }

    it('reads what a contract covers out of the archive the chart draws', async () => {
        // Answered from a second store kept beside it, a listing can say a
        // stretch was recorded that the chart cannot draw a column of.
        await service.listInstruments();

        expect(readCoverage).toHaveBeenCalledWith('BTCUSDT');
    });

    it('carries the coverage it was given, both edges and the touch', async () => {
        const [instrument] = await service.listInstruments();

        expect(instrument).toMatchObject({
            instrumentSymbol: 'BTCUSDT',
            firstFrameAtMs: COVERAGE.firstFrameAtMs,
            lastFrameAtMs: COVERAGE.lastFrameAtMs,
            lastMidPrice: COVERAGE.lastMidPrice,
        });
    });

    it('lists a contract that has been switched on and not yet recorded', async () => {
        // A registry entry with nothing against it is a real answer: the
        // contract is being captured and has produced nothing to draw yet.
        readCoverage.mockResolvedValue(null);

        const [instrument] = await service.listInstruments();

        expect(instrument).toMatchObject({
            instrumentSymbol: 'BTCUSDT',
            firstFrameAtMs: null,
            lastFrameAtMs: null,
            lastMidPrice: null,
        });
    });

    it('asks for gaps that overlap the window, not only those inside it', async () => {
        await service.fetchGaps({ symbol: 'BTCUSDT', fromMs: 1_000, toMs: 2_000, maxColumns: 60 });

        expect(theQuery().statement)
            .toContain('gap_ended_at >= $2 AND gap_started_at < $3');
    });

    it('reads what traded from the execution grid', async () => {
        await service.fetchTradeClusters({
            symbol: 'BTCUSDT',
            fromMs: 1_000,
            toMs: 2_000,
            maxColumns: 60,
            priceGroupSize: 1,
            minimumQuantity: 0,
            maxClusters: 5_000,
        });

        expect(theQuery().statement).toContain('trade_cluster');
    });
});
