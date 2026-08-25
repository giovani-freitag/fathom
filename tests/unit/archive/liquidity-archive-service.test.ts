import { describe, expect, it } from 'vitest';
import { LiquidityArchiveService } from '../../../src/archive/liquidity-archive-service.ts';
import { createPostgresServiceMock } from '../../mocks/postgres-service.ts';

function buildFrame(capturedAtMs: number) {
    return {
        capturedAtMs,
        bestBidPrice: 100,
        bestAskPrice: 101,
        bids: { lowestBucketIndex: 9, quantities: Float32Array.from([1, 2]) },
        asks: { lowestBucketIndex: 10, quantities: Float32Array.from([3]) },
    };
}

describe('LiquidityArchiveService', () => {
    it('writes nothing when handed no frames', async () => {
        const postgres = createPostgresServiceMock();
        const archive = new LiquidityArchiveService({ postgres: postgres.service });

        await archive.appendFrames({ instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frames: [] });

        expect(postgres.execute).not.toHaveBeenCalled();
    });

    it('lets a replayed instant collapse onto the row already stored', async () => {
        const postgres = createPostgresServiceMock();
        const archive = new LiquidityArchiveService({ postgres: postgres.service });

        await archive.appendFrames({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            frames: [buildFrame(1_000)],
        });

        expect(postgres.execute.mock.calls[0]?.[0]).toContain('ON CONFLICT DO NOTHING');
    });

    it('binds the depth arrays as plain arrays the driver can serialise', async () => {
        const postgres = createPostgresServiceMock();
        const archive = new LiquidityArchiveService({ postgres: postgres.service });

        await archive.appendFrames({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            frames: [buildFrame(1_000)],
        });

        const parameters = postgres.execute.mock.calls[0]?.[1] as unknown[];

        expect(Array.isArray(parameters[6])).toBe(true);
    });

    it('splits a batch larger than one statement can bind', async () => {
        const postgres = createPostgresServiceMock();
        const archive = new LiquidityArchiveService({ postgres: postgres.service });
        const frames = Array.from({ length: 1_200 }, (_unused, index) => buildFrame(index * 1_000));

        await archive.appendFrames({ instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frames });

        expect(postgres.execute.mock.calls.length).toBe(3);
    });

    it('reports no previous run when the instrument has never been recorded', async () => {
        const postgres = createPostgresServiceMock();
        postgres.selectRows.mockResolvedValue([{ last_captured_at: null }]);
        const archive = new LiquidityArchiveService({ postgres: postgres.service });

        const lastFrameMs = await archive.findLastFrameTimestamp('BTCUSDT');

        expect(lastFrameMs).toBeNull();
    });

    it('returns the newest recorded instant as milliseconds', async () => {
        const postgres = createPostgresServiceMock();
        postgres.selectRows.mockResolvedValue([{ last_captured_at: new Date(1_787_606_652_000) }]);
        const archive = new LiquidityArchiveService({ postgres: postgres.service });

        const lastFrameMs = await archive.findLastFrameTimestamp('BTCUSDT');

        expect(lastFrameMs).toBe(1_787_606_652_000);
    });
});
