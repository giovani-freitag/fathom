import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildFrame } from '../../mocks/chart-services.ts';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbHeatmapSource } from '../../../src/database/browser/indexed-db-heatmap-source.ts';
import { IndexedDbLiquidityArchive } from '../../../src/database/browser/indexed-db-liquidity-archive.ts';
import { IndexedDbService } from '../../../src/database/browser/indexed-db-service.ts';

const GRID = { priceBucketSize: 10, frameIntervalMs: 1_000 };
const FIRST_MS = 1_000_000;

describe('IndexedDbHeatmapSource', () => {
    let archive: IndexedDbLiquidityArchive;
    let source: IndexedDbHeatmapSource;

    beforeEach(async () => {
        const database = new IndexedDbService({ factory: new IDBFactory() });
        archive = new IndexedDbLiquidityArchive({ database, frameCapacity: 100_000 });
        source = new IndexedDbHeatmapSource({ database });
        await archive.open();

        await archive.registerInstrument({ instrumentSymbol: 'BTCUSDT', ...GRID });
        await archive.appendFrames({
            instrumentSymbol: 'BTCUSDT',
            ...GRID,
            frames: Array.from({ length: 600 }, (_, i) => buildFrame(FIRST_MS + i * 1_000)),
        });
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
        // 600 seconds into 60 columns: reading every frame would hand the page
        // ten times the data it can draw and cost the memory to match.
        const window = await source.fetchFrameWindow({
            symbol: 'BTCUSDT', fromMs: FIRST_MS, toMs: FIRST_MS + 600_000, maxColumns: 60,
        });

        expect(window.sampleIntervalMs).toBe(10_000);
        expect(window.frames.length).toBeLessThanOrEqual(60);
        expect(window.frames.length).toBeGreaterThan(50);
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
});
