import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidityQueryService } from '../../../src/database/services/liquidity-query-service.ts';
import type { PostgresService } from '../../../src/database/postgres/postgres-service.ts';

const GRID_ROW = { price_bucket_size: 10, frame_interval_ms: 1_000 };

interface Asked {
    readonly statement: string;
    readonly values: readonly unknown[];
}

describe('LiquidityQueryService', () => {
    let asked: Asked[];
    let service: LiquidityQueryService;

    beforeEach(() => {
        asked = [];
        const selectRows = vi.fn((statement: string, values: readonly unknown[]) => {
            asked.push({ statement, values });
            // Every read resolves its grid first; everything after it is the
            // query under test, which no test here needs rows back from.
            return Promise.resolve(statement.includes('instrument_registry') ? [GRID_ROW] : []);
        });
        service = new LiquidityQueryService({ postgres: { selectRows } as unknown as PostgresService });
    });

    /** The statement the read is actually about, past the grid lookup. */
    function theQuery(): Asked {
        return asked[asked.length - 1]!;
    }

    it('reads a window with one bucketed scan rather than a probe per column', async () => {
        // A lateral probe per bucket answers in 0.018 ms against a row chunk and
        // has to decompress a whole batch against a compressed one, which turned
        // an hour of two-day-old history into a seven-second read.
        await service.fetchFrameWindow({
            symbol: 'BTCUSDT', fromMs: 0, toMs: 3_600_000, maxColumns: 600,
        });

        expect(theQuery().statement).toContain('DISTINCT ON (time_bucket(');
        expect(asked.filter((query) => query.statement.includes('liquidity_frame'))).toHaveLength(1);
    });

    it('probes finer than the columns it returns, so a column is not one instant', async () => {
        await service.fetchFrameWindow({
            symbol: 'BTCUSDT', fromMs: 0, toMs: 600_000, maxColumns: 60,
        });

        // 600s over 60 columns is 10s a column; the probe has to be under that.
        const probeSeconds = theQuery().values[3] as number;
        expect(probeSeconds).toBeLessThan(10);
        expect(probeSeconds).toBeGreaterThanOrEqual(1);
    });

    it('never probes finer than the grid the frames were recorded on', async () => {
        await service.fetchFrameWindow({
            symbol: 'BTCUSDT', fromMs: 0, toMs: 10_000, maxColumns: 4_000,
        });

        expect(theQuery().values[3]).toBe(1);
    });

    it('asks the raw table for a window fine enough to need it', async () => {
        await service.fetchTradeClusters({
            symbol: 'BTCUSDT', fromMs: 0, toMs: 60_000, maxColumns: 600,
            priceGroupSize: 1, minimumQuantity: 0, maxClusters: 5_000,
        });

        expect(theQuery().statement).toContain('FROM trade_cluster');
    });

    it('asks a rolled-up view once the window is wider than one', async () => {
        // A week of prints read raw is millions of rows for a few hundred
        // columns; the aggregate already holds them at that resolution.
        await service.fetchTradeClusters({
            symbol: 'BTCUSDT', fromMs: 0, toMs: 7 * 24 * 3_600_000, maxColumns: 600,
            priceGroupSize: 1, minimumQuantity: 0, maxClusters: 5_000,
        });

        expect(theQuery().statement).not.toContain('FROM trade_cluster\n');
        expect(theQuery().statement).toMatch(/FROM trade_cluster_\w+/);
    });

    it('asks for gaps that overlap the window, not only those inside it', async () => {
        await service.fetchGaps({ symbol: 'BTCUSDT', fromMs: 1_000, toMs: 2_000, maxColumns: 60 });

        expect(theQuery().statement)
            .toContain('gap_ended_at >= $2 AND gap_started_at < $3');
    });
});

describe('LiquidityQueryService price bars', () => {
    let asked: Asked[];
    let service: LiquidityQueryService;
    let rows: Record<string, unknown>[];

    beforeEach(() => {
        asked = [];
        rows = [];
        const selectRows = vi.fn((statement: string, values: readonly unknown[]) => {
            asked.push({ statement, values });
            return Promise.resolve(statement.includes('instrument_registry') ? [GRID_ROW] : rows);
        });
        service = new LiquidityQueryService({ postgres: { selectRows } as unknown as PostgresService });
    });

    /** One aggregated bucket, as the database hands it back. */
    function buildRow(openedAtMs: number, frameCount: number): Record<string, unknown> {
        return {
            bucket_start: new Date(openedAtMs),
            open_price: 100, high_price: 110, low_price: 90, close_price: 105,
            frame_count: frameCount,
            first_frame_at: new Date(openedAtMs),
            last_frame_at: new Date(openedAtMs + frameCount * 1_000),
        };
    }

    function theQuery(): Asked {
        return asked[asked.length - 1]!;
    }

    it('never names the depth arrays, which is what makes the read cheap', async () => {
        await service.fetchPriceBars({
            symbol: 'BTCUSDT', fromMs: 0, toMs: 600_000, intervalMs: 60_000, warmupBars: 0,
        });

        expect(theQuery().statement).not.toContain('quantities');
    });

    it('snaps the range outward, so a bar keeps its shape however it was asked for', async () => {
        // Asked from 23 seconds into a minute, the bucket still starts on the
        // minute; otherwise the same bar arrives with a different high depending
        // on where the reader happened to have panned to.
        await service.fetchPriceBars({
            symbol: 'BTCUSDT', fromMs: 23_000, toMs: 130_000, intervalMs: 60_000, warmupBars: 0,
        });

        const [, fromAt, toAt] = theQuery().values as [string, Date, Date];
        expect(fromAt.getTime()).toBe(0);
        expect(toAt.getTime()).toBe(180_000);
    });

    it('reads warm-up as whole buckets before the range, not as a wider range', async () => {
        await service.fetchPriceBars({
            symbol: 'BTCUSDT', fromMs: 600_000, toMs: 660_000, intervalMs: 60_000, warmupBars: 3,
        });

        expect((theQuery().values[1] as Date).getTime()).toBe(600_000 - 3 * 60_000);
    });

    it('counts the warm-up it could actually supply', async () => {
        rows = [buildRow(480_000, 60), buildRow(540_000, 60), buildRow(600_000, 60)];

        const window = await service.fetchPriceBars({
            symbol: 'BTCUSDT', fromMs: 600_000, toMs: 660_000, intervalMs: 60_000, warmupBars: 5,
        });

        expect(window).toMatchObject({ warmupBarsRequested: 5, warmupBarsReturned: 2 });
    });

    it('says a bucket is short of frames rather than passing it off as whole', async () => {
        rows = [buildRow(0, 3)];

        const [bar] = (await service.fetchPriceBars({
            symbol: 'BTCUSDT', fromMs: 0, toMs: 60_000, intervalMs: 60_000, warmupBars: 0,
        })).bars;

        expect(bar).toMatchObject({ frameCount: 3, expectedFrames: 60, isClosed: true });
    });

    it('marks a bucket that can still grow as unfinished', async () => {
        // Without this a bar the collector is still filling reads exactly like
        // one it missed most of, and the chart would mark it as a fault.
        const openedAtMs = Math.floor(Date.now() / 60_000) * 60_000;
        rows = [buildRow(openedAtMs, 12)];

        const [bar] = (await service.fetchPriceBars({
            symbol: 'BTCUSDT', fromMs: openedAtMs, toMs: openedAtMs + 60_000,
            intervalMs: 60_000, warmupBars: 0,
        })).bars;

        expect(bar?.isClosed).toBe(false);
    });

    it('never bins finer than the grid the frames were recorded on', async () => {
        const window = await service.fetchPriceBars({
            symbol: 'BTCUSDT', fromMs: 0, toMs: 10_000, intervalMs: 100, warmupBars: 0,
        });

        expect(window.intervalMs).toBe(1_000);
    });

    it('leaves an unrecorded bucket out rather than filling it with zeros', async () => {
        rows = [buildRow(0, 60), buildRow(120_000, 60)];

        const window = await service.fetchPriceBars({
            symbol: 'BTCUSDT', fromMs: 0, toMs: 180_000, intervalMs: 60_000, warmupBars: 0,
        });

        expect(window.bars.map((bar) => bar.openedAtMs)).toEqual([0, 120_000]);
    });
});
