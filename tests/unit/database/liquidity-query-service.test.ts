import { FIRST_VENUE } from '../../../src/shared/core/recording-control.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChunkCoverage, ChunkRowStore } from '../../../src/database/core/chunk-row-store.ts';
import { LiquidityQueryService } from '../../../src/database/services/liquidity-query-service.ts';
import type { PostgresService } from '../../../src/database/postgres/postgres-service.ts';

const REGISTRY_ROW = {
    instrument_symbol: 'BTCUSDT',
    venue: FIRST_VENUE,
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
        // The real one defaults its parameters, and the listing calls it with
        // none — so a double that insists on them hides which call is which.
        const selectRows = vi.fn((statement: string, values: readonly unknown[] = []) => {
            asked.push({ statement, values });
            // The registry answers per contract now, so a grid asked for under
            // a venue that has no row there gets none — which is what makes the
            // listing above, with no parameters at all, the one that returns it.
            const isRegistry = statement.includes('instrument_registry');
            const named = values[0];
            const isKnown = named === undefined || named === REGISTRY_ROW.venue;
            return Promise.resolve(isRegistry && isKnown ? [REGISTRY_ROW] : []);
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

        expect(readCoverage).toHaveBeenCalledWith({
            venue: FIRST_VENUE,
            instrumentSymbol: 'BTCUSDT',
        });
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
        await service.fetchGaps({
            symbol: 'BTCUSDT', venue: FIRST_VENUE,
            fromMs: 1_000, toMs: 2_000, maxColumns: 60,
        });

        expect(theQuery().statement)
            .toContain('gap_ended_at >= $3 AND gap_started_at < $4');
    });

    it('asks the registry for the grid of the venue that was named', async () => {
        // Two venues listing one symbol are recorded on two grids, and every
        // price in the answer is placed against whichever grid came back. Looked
        // up by the symbol alone, the row that sorted first would decide what
        // the other venue's executions are laid on.
        await service.fetchTradeClusters({
            symbol: 'BTCUSDT',
            venue: 'a-venue-nobody-recorded',
            fromMs: 1_000,
            toMs: 2_000,
            maxColumns: 60,
            priceGroupSize: 1,
            minimumQuantity: 0,
            maxClusters: 100,
        });

        const registry = asked.find((one) => one.statement.includes('instrument_registry'));
        expect(registry?.values).toEqual(['a-venue-nobody-recorded', 'BTCUSDT']);
    });

    it('reads what traded from the execution grid', async () => {
        await service.fetchTradeClusters({
            symbol: 'BTCUSDT',
            venue: FIRST_VENUE,
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

describe('LiquidityQueryService asked about a contract nobody recorded', () => {
    let service: LiquidityQueryService;

    beforeEach(() => {
        const selectRows = vi.fn(() => Promise.resolve([]));
        service = new LiquidityQueryService({
            postgres: { selectRows } as unknown as PostgresService,
            chunks: { readCoverage: vi.fn() } as unknown as ChunkRowStore,
        });
    });

    it('answers with an empty tape rather than refusing', async () => {
        // A reader may open any contract a venue lists, and the executions come
        // from the recording. Asking what traded on one nobody recorded is an
        // ordinary question — answered as a fault, it reaches the reader as the
        // gateway being broken rather than as this contract having no tape.
        const window = await service.fetchTradeClusters({
            symbol: 'BTCUSDT',
            venue: 'a-venue-nobody-recorded',
            fromMs: 1_000,
            toMs: 2_000,
            maxColumns: 60,
            priceGroupSize: 1,
            minimumQuantity: 0,
            maxClusters: 100,
        });

        expect(window.clusters).toEqual([]);
    });
});
