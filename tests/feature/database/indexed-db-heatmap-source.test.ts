import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildFrame } from '../../mocks/chart-services.ts';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbHeatmapSource } from '../../../src/database/browser/indexed-db-heatmap-source.ts';
import { IndexedDbLiquidityArchive } from '../../../src/database/browser/indexed-db-liquidity-archive.ts';
import { IndexedDbService } from '../../../src/database/browser/indexed-db-service.ts';
import { ChunkArchiveService } from '../../../src/database/services/chunk-archive-service.ts';
import { ChunkTileRecorder } from '../../../src/database/services/chunk-tile-recorder.ts';
import { recordInstants } from '../../mocks/browser-recording.ts';
import { IndexedDbChunkRowStore } from '../../../src/database/browser/indexed-db-chunk-row-store.ts';
import type { LiquidityFrame, LiquidityFrameWindow } from '../../../src/shared/core/liquidity-frame.ts';

const GRID = { priceBucketSize: 10, frameIntervalMs: 1_000 };
const FIRST_MS = 1_000_000;

describe('IndexedDbHeatmapSource', () => {
    let archive: IndexedDbLiquidityArchive;
    let source: IndexedDbHeatmapSource;
    let database: IndexedDbService;

    beforeEach(async () => {
        database = new IndexedDbService({ factory: new IDBFactory() });
        archive = new IndexedDbLiquidityArchive({
            database,
            chunks: new IndexedDbChunkRowStore({ database }),
        });
        source = new IndexedDbHeatmapSource({ database });
        await archive.open();

        await archive.registerInstrument({ instrumentSymbol: 'BTCUSDT', ...GRID });
        await recordInstants({ database, fromMs: FIRST_MS, count: 600 });
    });

    it('reports the stretch it actually holds, not the one it was asked for', async () => {
        const [instrument] = await source.fetchInstruments();

        expect(instrument).toMatchObject({
            instrumentSymbol: 'BTCUSDT',
            firstFrameAtMs: FIRST_MS,
            lastFrameAtMs: FIRST_MS + 599_000,
        });
    });

    it('says a registered contract holds nothing rather than pretending it does', async () => {
        await archive.registerInstrument({ instrumentSymbol: 'ETHUSDT', ...GRID });

        const eth = (await source.fetchInstruments())
            .find((instrument) => instrument.instrumentSymbol === 'ETHUSDT');

        expect(eth).toMatchObject({ firstFrameAtMs: null, lastFrameAtMs: null });
    });

    it('thins a long window down to about the columns the screen can show', async () => {
        // 600 seconds into 60 columns: reading every instant would hand the page
        // ten times the data it can draw and cost the memory to match.
        //
        // Answered on the archive's own grid rather than exactly the ten
        // seconds asked for. It keeps levels a fixed factor apart, so it thins
        // to the first level coarse enough — never finer than asked, which is
        // the promise that matters, and never so coarse the window empties.
        const window = await source.fetchFrameWindow({
            symbol: 'BTCUSDT', fromMs: FIRST_MS, toMs: FIRST_MS + 600_000, maxColumns: 60,
        });

        expect(window.sampleIntervalMs).toBeGreaterThanOrEqual(10_000);
        expect(window.frames.length).toBeLessThanOrEqual(60);
        expect(window.frames.length).toBeGreaterThan(20);
    });

    it('never samples finer than the grid the frames were recorded on', async () => {
        const window = await source.fetchFrameWindow({
            symbol: 'BTCUSDT', fromMs: FIRST_MS, toMs: FIRST_MS + 10_000, maxColumns: 4_000,
        });

        expect(window.sampleIntervalMs).toBe(GRID.frameIntervalMs);
    });

    it('answers with the grid a contract was recorded on', async () => {
        const window = await source.fetchFrameWindow({
            symbol: 'BTCUSDT', fromMs: FIRST_MS, toMs: FIRST_MS + 60_000, maxColumns: 60,
        });

        expect(window.priceBucketSize).toBe(GRID.priceBucketSize);
    });

    it('returns a gap that overlaps the window even though it started before it', async () => {
        // A gap the reader is looking at from the middle still has to be drawn,
        // or the chart claims that stretch was recorded.
        await archive.recordGap({
            instrumentSymbol: 'BTCUSDT',
            gap: { gapStartedAtMs: FIRST_MS - 5_000, gapEndedAtMs: FIRST_MS + 2_000, gapReason: 'the stream dropped' },
        });
        await archive.recordGap({
            instrumentSymbol: 'BTCUSDT',
            gap: { gapStartedAtMs: FIRST_MS - 90_000, gapEndedAtMs: FIRST_MS - 80_000, gapReason: 'the stream dropped' },
        });

        const gaps = await source.fetchGaps({
            symbol: 'BTCUSDT', fromMs: FIRST_MS, toMs: FIRST_MS + 60_000, maxColumns: 60,
        });

        expect(gaps).toHaveLength(1);
        expect(gaps[0]?.gapEndedAtMs).toBe(FIRST_MS + 2_000);
    });

    it('keeps executions inside the window it was asked about', async () => {
        const build = (executedAtMs: number) => ({
            executedAtMs, priceBucketIndex: 7_900,
            buyQuantity: 1, sellQuantity: 0, tradeCount: 1, largestTradeQuantity: 1,
        });
        await archive.appendTradeClusters({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            clusters: [build(FIRST_MS + 1_000), build(FIRST_MS + 30_000), build(FIRST_MS + 500_000)],
        });

        const result = await source.fetchTradeClusters({
            symbol: 'BTCUSDT', fromMs: FIRST_MS, toMs: FIRST_MS + 60_000, maxColumns: 60,
        });

        expect(result.clusters).toHaveLength(2);
    });


    it('reads the whole book out of the squares when the chart asks for them', async () => {
        // The page keeps both: the band around the price, and the whole book as
        // squares. A wall standing half again above the price is only in the
        // squares, which is the reason they are recorded at all.
        const recorder = new ChunkTileRecorder({
            archive: new ChunkArchiveService({ rows: new IndexedDbChunkRowStore({ database }) }),
            priceRangeRatio: 1,
            intervalMs: GRID.frameIntervalMs,
            stepRatio: 1.02,
        });
        const recording = recorder.buildRecording('BTCUSDT', GRID.priceBucketSize);
        for (let offset = 0; offset < 20; offset += 1) {
            recording.onFrame(withFarWall(buildFrame(FIRST_MS + offset * 1_000)), GRID.priceBucketSize);
        }
        await recorder.flush();

        const window = await source.fetchFrameWindow({
            symbol: 'BTCUSDT',
            fromMs: FIRST_MS,
            toMs: FIRST_MS + 20_000,
            maxColumns: 100,
        });

        expect(highestPriced(window)).toBeGreaterThanOrEqual(FAR_WALL_BUCKET);
    });

});

/** A price a long way above the touch, which the recorded band never reaches. */
const FAR_WALL_BUCKET = 15_400;

/** The same instant with one wall standing far above the price. */
function withFarWall(frame: LiquidityFrame): LiquidityFrame {
    const lowest = frame.asks.lowestBucketIndex;
    const quantities = new Float32Array(FAR_WALL_BUCKET - lowest + 1);
    quantities.set(frame.asks.quantities);
    quantities[FAR_WALL_BUCKET - lowest] = 500;
    return { ...frame, asks: { lowestBucketIndex: lowest, quantities } };
}

/** The highest price bucket a window holds anything at. */
function highestPriced(window: LiquidityFrameWindow): number {
    let highest = -1;
    for (const frame of window.frames) {
        for (const ladder of [frame.bids, frame.asks]) {
            for (let index = 0; index < ladder.quantities.length; index += 1) {
                if ((ladder.quantities[index] ?? 0) > 0) {
                    highest = Math.max(highest, ladder.lowestBucketIndex + index);
                }
            }
        }
    }
    return highest;
}
