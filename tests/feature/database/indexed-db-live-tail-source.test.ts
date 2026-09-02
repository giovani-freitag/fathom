import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbLiquidityArchive } from '../../../src/database/browser/indexed-db-liquidity-archive.ts';
import { IndexedDbChunkRowStore } from '../../../src/database/browser/indexed-db-chunk-row-store.ts';
import { IndexedDbLiveTailSource } from '../../../src/database/browser/indexed-db-live-tail-source.ts';
import { IndexedDbService } from '../../../src/database/browser/indexed-db-service.ts';

const GRID = { priceBucketSize: 10, frameIntervalMs: 1_000 };
const FIRST_MS = 1_000_000;

function buildCluster(executedAtMs: number, priceBucketIndex = 7_900) {
    return {
        executedAtMs, priceBucketIndex,
        buyQuantity: 1, sellQuantity: 0, tradeCount: 1, largestTradeQuantity: 1,
    };
}

describe('IndexedDbLiveTailSource carrying what no store keeps twice', () => {
    let archive: IndexedDbLiquidityArchive;
    let source: IndexedDbLiveTailSource;

    beforeEach(async () => {
        const database = new IndexedDbService({ factory: new IDBFactory() });
        archive = new IndexedDbLiquidityArchive({
            database,
            chunks: new IndexedDbChunkRowStore({ database }),
        });
        source = new IndexedDbLiveTailSource({ database });
        await archive.open();
        await archive.registerInstrument({ instrumentSymbol: 'BTCUSDT', ...GRID });
    });

    it('reads the executions of the stretch the frames just covered', async () => {
        // The read the tail makes on every pass. It is the one that never ran
        // in the page, which left aggressor bubbles frozen until a reload.
        await archive.appendTradeClusters({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            clusters: [
                buildCluster(FIRST_MS),
                buildCluster(FIRST_MS + 1_000),
                buildCluster(FIRST_MS + 1_000, 7_910),
                buildCluster(FIRST_MS + 9_000),
            ],
        });

        const clusters = await source.fetchTradeClustersBetween({
            symbol: 'BTCUSDT', fromMs: FIRST_MS, toMs: FIRST_MS + 1_001,
        });

        expect(clusters).toHaveLength(3);
    });

    it('keeps one contract s executions out of another s', async () => {
        await archive.appendTradeClusters({
            instrumentSymbol: 'ETHUSDT', priceBucketSize: 0.5, clusters: [buildCluster(FIRST_MS)],
        });

        const clusters = await source.fetchTradeClustersBetween({
            symbol: 'BTCUSDT', fromMs: 0, toMs: FIRST_MS + 100_000,
        });

        expect(clusters).toEqual([]);
    });

    it('reports a gap that ended inside the stretch', async () => {
        await archive.recordGap({
            instrumentSymbol: 'BTCUSDT',
            gap: { gapStartedAtMs: FIRST_MS - 500, gapEndedAtMs: FIRST_MS + 500, gapReason: 'the stream dropped' },
        });

        const gaps = await source.fetchGapsBetween({
            symbol: 'BTCUSDT', fromMs: FIRST_MS, toMs: FIRST_MS + 1_000,
        });

        expect(gaps).toHaveLength(1);
    });

    it('does not report a gap the reader has already been told about', async () => {
        await archive.recordGap({
            instrumentSymbol: 'BTCUSDT',
            gap: { gapStartedAtMs: 1, gapEndedAtMs: 2, gapReason: 'the stream dropped' },
        });

        const gaps = await source.fetchGapsBetween({
            symbol: 'BTCUSDT', fromMs: FIRST_MS, toMs: FIRST_MS + 1_000,
        });

        expect(gaps).toEqual([]);
    });
});
