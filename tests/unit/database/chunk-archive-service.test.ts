import { describe, expect, it } from 'vitest';
import { PostgresChunkRowStore } from '../../../src/database/postgres/postgres-chunk-row-store.ts';
import { ChunkArchiveService } from '../../../src/database/services/chunk-archive-service.ts';
import { createChunkStoreMock } from '../../mocks/chunk-store.ts';

const INTERVAL_MS = 1_000;
const BUCKET_SIZE = 10;
const STARTED_AT_MS = 1_700_000_000_000;

/** One instant with a size resting at one price, to be placed on a scale. */
const COLUMN = {
    bestBidPrice: 77_930,
    bestAskPrice: 77_940,
    steps: new Map<number, number>([[7_793, 120]]),
};

describe('ChunkArchiveService writing a block', () => {
    it('stamps the block with the scale the sizes were placed on', async () => {
        // The writer places every size on a scale before the archive ever sees
        // it, and the archive stamps that scale onto the block for the reader to
        // decode by. A copy of it kept on this side would be stamped while the
        // sizes were placed on another, and every size in the store would read
        // back wrong by the ratio between the two — silently, because both
        // halves go on working.
        const store = createChunkStoreMock();
        const archive = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres: store.service }) });

        await archive.writeBlock({
            instrumentSymbol: 'BTCUSDT',
            detailLevel: 0,
            columnIntervalMs: INTERVAL_MS,
            priceBucketSize: BUCKET_SIZE,
            scale: { stepRatio: 1.5, smallestQuantity: 0.25 },
            startedAtMs: STARTED_AT_MS,
            columns: [COLUMN],
            isComplete: false,
        });

        expect(store.rows('block')[0]).toMatchObject({
            step_ratio: 1.5, smallest_quantity: 0.25,
        });
    });
});
