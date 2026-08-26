// Installs IDBKeyRange and friends as globals, which the archive reaches for
// the way a page does. A fresh factory per test then keeps the stores isolated.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFrame } from '../../mocks/chart-services.ts';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbLiquidityArchive } from '../../../src/database/browser/indexed-db-liquidity-archive.ts';
import { IndexedDbService } from '../../../src/database/browser/indexed-db-service.ts';
import type { LiquidityFrame } from '../../../src/shared/core/liquidity-frame.ts';
import { STORES } from '../../../src/database/browser/browser-schema.ts';

const GRID = { priceBucketSize: 10, frameIntervalMs: 1_000 };

/** A run of frames one second apart, which is the grid a collector records on. */
function buildRun(count: number, fromMs = 1_000_000): LiquidityFrame[] {
    return Array.from({ length: count }, (_, index) => buildFrame(fromMs + index * 1_000));
}

describe('IndexedDbLiquidityArchive', () => {
    let database: IndexedDbService;
    let archive: IndexedDbLiquidityArchive;

    beforeEach(async () => {
        database = new IndexedDbService({ factory: new IDBFactory() });
        archive = new IndexedDbLiquidityArchive({ database, frameCapacity: 10 });
        await archive.open();
    });

    afterEach(async () => {
        await archive.close();
    });

    async function countFrames(): Promise<number> {
        return database.countRange(STORES.liquidityFrame, null);
    }

    it('records a frame once, however many times the same instant arrives', async () => {
        // A reconnecting collector replays the second it was cut off in, and the
        // compound key is what stops that second being recorded twice.
        await archive.appendFrames({ instrumentSymbol: 'BTCUSDT', ...GRID, frames: buildRun(3) });
        await archive.appendFrames({ instrumentSymbol: 'BTCUSDT', ...GRID, frames: buildRun(3) });

        expect(await countFrames()).toBe(3);
    });

    it('reads back the newest instant, not the first', async () => {
        await archive.appendFrames({ instrumentSymbol: 'BTCUSDT', ...GRID, frames: buildRun(5) });

        expect(await archive.findLastFrameTimestamp('BTCUSDT')).toBe(1_004_000);
    });

    it('answers for a contract it has never recorded', async () => {
        expect(await archive.findLastFrameTimestamp('ETHUSDT')).toBeNull();
    });

    it('drops the oldest frames once the window is longer than it may be', async () => {
        await archive.appendFrames({ instrumentSymbol: 'BTCUSDT', ...GRID, frames: buildRun(14) });

        const dropped = await archive.pruneToCapacity('BTCUSDT');

        expect(dropped).toBe(4);
        expect(await countFrames()).toBe(10);
        expect(await archive.findLastFrameTimestamp('BTCUSDT')).toBe(1_013_000);
    });

    it('leaves a window that still fits alone', async () => {
        await archive.appendFrames({ instrumentSymbol: 'BTCUSDT', ...GRID, frames: buildRun(10) });

        expect(await archive.pruneToCapacity('BTCUSDT')).toBe(0);
    });

    it('trims one contract without touching what another recorded', async () => {
        // The compound key sorts by time within an instrument, so the range
        // delete has to stop at the instrument boundary or a busy contract
        // would drop a quiet one's history along with its own.
        await archive.appendFrames({ instrumentSymbol: 'BTCUSDT', ...GRID, frames: buildRun(14) });
        await archive.appendFrames({ instrumentSymbol: 'ETHUSDT', ...GRID, frames: buildRun(4) });

        await archive.pruneToCapacity('BTCUSDT');

        expect(await countFrames()).toBe(14);
        expect(await archive.findLastFrameTimestamp('ETHUSDT')).toBe(1_003_000);
    });

    it('takes the executions and the gaps that fell below the horizon with it', async () => {
        await archive.appendFrames({ instrumentSymbol: 'BTCUSDT', ...GRID, frames: buildRun(14) });
        await archive.appendTradeClusters({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            clusters: [
                { executedAtMs: 1_000_000, priceBucketIndex: 7_900, buyQuantity: 1, sellQuantity: 0, tradeCount: 1, largestTradeQuantity: 1 },
                { executedAtMs: 1_013_000, priceBucketIndex: 7_900, buyQuantity: 1, sellQuantity: 0, tradeCount: 1, largestTradeQuantity: 1 },
            ],
        });
        await archive.recordGap({
            instrumentSymbol: 'BTCUSDT',
            gap: { gapStartedAtMs: 1_000_500, gapEndedAtMs: 1_001_000, gapReason: 'the stream dropped' },
        });

        await archive.pruneToCapacity('BTCUSDT');

        expect(await database.countRange(STORES.tradeCluster, null)).toBe(1);
        expect(await database.countRange(STORES.recordingGap, null)).toBe(0);
    });

    it('keeps a gap that is still open at the horizon', async () => {
        // A gap that ends inside the window it is still describing has to
        // survive, or the chart claims a stretch was recorded when it was not.
        await archive.appendFrames({ instrumentSymbol: 'BTCUSDT', ...GRID, frames: buildRun(14) });
        await archive.recordGap({
            instrumentSymbol: 'BTCUSDT',
            gap: { gapStartedAtMs: 1_000_500, gapEndedAtMs: 1_012_000, gapReason: 'the stream dropped' },
        });

        await archive.pruneToCapacity('BTCUSDT');

        expect(await database.countRange(STORES.recordingGap, null)).toBe(1);
    });
});
