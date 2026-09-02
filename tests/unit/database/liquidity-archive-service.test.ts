import { describe, expect, it } from 'vitest';
import { LiquidityArchiveService } from '../../../src/database/services/liquidity-archive-service.ts';
import { createPostgresServiceMock } from '../../mocks/postgres-service.ts';
import type { ChunkRowStore } from '../../../src/database/core/chunk-row-store.ts';

/** An archive that answers with whatever coverage a test names. */
function buildChunks(lastFrameAtMs: number | null): ChunkRowStore {
    return {
        readCoverage: () => Promise.resolve(
            lastFrameAtMs === null
                ? null
                : { firstFrameAtMs: 0, lastFrameAtMs, lastMidPrice: 100 },
        ),
    } as unknown as ChunkRowStore;
}

describe('LiquidityArchiveService reporting the previous run', () => {
    it('reports no previous run when the contract has never been recorded', async () => {
        const postgres = createPostgresServiceMock();
        const archive = new LiquidityArchiveService({
            postgres: postgres.service,
            chunks: buildChunks(null),
        });

        expect(await archive.findLastFrameTimestamp('BTCUSDT')).toBeNull();
    });

    it('returns the newest recorded instant, which is where a gap reopens', async () => {
        // The collector reopens the stretch between its last write and now, so
        // the answer decides how much downtime is written into the ledger.
        const postgres = createPostgresServiceMock();
        const archive = new LiquidityArchiveService({
            postgres: postgres.service,
            chunks: buildChunks(1_700_000_000_000),
        });

        expect(await archive.findLastFrameTimestamp('BTCUSDT')).toBe(1_700_000_000_000);
    });

    it('asks the archive the chart draws, not a store kept beside it', async () => {
        // Answered from anywhere else, a collector restarted after an outage
        // writes a gap that does not match what a reader can actually see.
        const postgres = createPostgresServiceMock();
        const archive = new LiquidityArchiveService({
            postgres: postgres.service,
            chunks: buildChunks(1_700_000_000_000),
        });

        await archive.findLastFrameTimestamp('BTCUSDT');

        expect(postgres.selectRows).not.toHaveBeenCalled();
    });
});
