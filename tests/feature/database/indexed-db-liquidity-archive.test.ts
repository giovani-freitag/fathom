import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbChunkRowStore } from '../../../src/database/browser/indexed-db-chunk-row-store.ts';
import { IndexedDbLiquidityArchive } from '../../../src/database/browser/indexed-db-liquidity-archive.ts';
import { IndexedDbService } from '../../../src/database/browser/indexed-db-service.ts';
import { recordInstants, RECORDING_GRID } from '../../mocks/browser-recording.ts';
import { STORES } from '../../../src/database/browser/browser-schema.ts';

const FIRST_MS = 1_000_000;

/** Instants kept, which the prune measures its horizon back from. */
const CAPACITY = 10;

describe('IndexedDbLiquidityArchive', () => {
    let database: IndexedDbService;
    let archive: IndexedDbLiquidityArchive;

    beforeEach(async () => {
        database = new IndexedDbService({ factory: new IDBFactory() });
        archive = new IndexedDbLiquidityArchive({
            database,
            chunks: new IndexedDbChunkRowStore({ database }),
            frameCapacity: CAPACITY,
        });
        await archive.open();
        await archive.registerInstrument({ instrumentSymbol: 'BTCUSDT', ...RECORDING_GRID });
    });

    afterEach(async () => {
        await archive.close();
    });

    /** How many blocks of the finest level are left for a contract. */
    async function countBlocks(): Promise<number> {
        return database.countRange(STORES.liquidityBlock, null);
    }

    it('reads back the newest instant, not the first', async () => {
        // What the collector reopens a gap from: answered with the oldest, a
        // restart writes a hole covering everything it actually recorded.
        await recordInstants({ database, fromMs: FIRST_MS, count: 5 });

        expect(await archive.findLastFrameTimestamp('BTCUSDT')).toBe(FIRST_MS + 4_000);
    });

    it('answers for a contract it has never recorded', async () => {
        expect(await archive.findLastFrameTimestamp('ETHUSDT')).toBeNull();
    });

    it('leaves a window that still fits alone', async () => {
        await recordInstants({ database, fromMs: FIRST_MS, count: CAPACITY });

        expect(await archive.pruneToCapacity('BTCUSDT')).toBe(0);
    });

    it('drops the oldest recording once the window is longer than it may be', async () => {
        await recordInstants({ database, fromMs: FIRST_MS, count: 1_200 });

        const dropped = await archive.pruneToCapacity('BTCUSDT');

        expect(dropped).toBeGreaterThan(0);
    });

    it('takes the executions that fell below the horizon with it', async () => {
        await recordInstants({ database, fromMs: FIRST_MS, count: 1_200 });
        await archive.appendTradeClusters({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: RECORDING_GRID.priceBucketSize,
            clusters: [
                { executedAtMs: FIRST_MS, priceBucketIndex: 7_900, buyQuantity: 1, sellQuantity: 0, tradeCount: 1, largestTradeQuantity: 1 },
                { executedAtMs: FIRST_MS + 1_199_000, priceBucketIndex: 7_900, buyQuantity: 1, sellQuantity: 0, tradeCount: 1, largestTradeQuantity: 1 },
            ],
        });

        await archive.pruneToCapacity('BTCUSDT');

        expect(await database.countRange(STORES.tradeCluster, null)).toBe(1);
    });

    it('keeps a gap that is still open at the horizon', async () => {
        // A gap that ends inside the window it is still describing has to
        // survive, or the chart claims a stretch was recorded when it was not.
        await recordInstants({ database, fromMs: FIRST_MS, count: 1_200 });
        await archive.recordGap({
            instrumentSymbol: 'BTCUSDT',
            gap: {
                gapStartedAtMs: FIRST_MS + 500,
                gapEndedAtMs: FIRST_MS + 1_198_000,
                gapReason: 'the stream dropped',
            },
        });

        await archive.pruneToCapacity('BTCUSDT');

        expect(await database.countRange(STORES.recordingGap, null)).toBe(1);
    });

    it('takes the squares of the whole book with the stretch they cover', async () => {
        // Left behind they are a store nothing prunes, and one block of the
        // coarsest level is a fifth of a megabyte that never leaves.
        await recordInstants({ database, fromMs: FIRST_MS, count: 1_200 });
        const before = await countBlocks();

        await archive.pruneToCapacity('BTCUSDT');

        expect(await countBlocks()).toBeLessThan(before);
    });
});
