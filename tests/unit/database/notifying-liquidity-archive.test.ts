import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFrame } from '../../mocks/chart-services.ts';
import type { LiquidityArchive } from '../../../src/database/services/liquidity-archive.ts';
import { NotifyingLiquidityArchive } from '../../../src/database/services/notifying-liquidity-archive.ts';

describe('NotifyingLiquidityArchive', () => {
    let written: string[];
    let appendFrames: ReturnType<typeof vi.fn>;
    let archive: NotifyingLiquidityArchive;

    beforeEach(() => {
        written = [];
        appendFrames = vi.fn().mockResolvedValue(undefined);
        archive = new NotifyingLiquidityArchive({
            archive: {
                open: vi.fn().mockResolvedValue(undefined),
                close: vi.fn().mockResolvedValue(undefined),
                registerInstrument: vi.fn().mockResolvedValue(undefined),
                appendFrames,
                appendTradeClusters: vi.fn().mockResolvedValue(undefined),
                recordGap: vi.fn().mockResolvedValue(undefined),
                findLastFrameTimestamp: vi.fn().mockResolvedValue(null),
            } as unknown as LiquidityArchive,
            onWritten: (instrumentSymbol) => { written.push(instrumentSymbol); },
        });
    });

    it('names the contract that just grew', async () => {
        await archive.appendFrames({
            instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frames: [buildFrame(1_000)],
        });

        expect(written).toEqual(['BTCUSDT']);
    });

    it('says nothing when the write was refused', async () => {
        // A reader told to catch up on a write that then failed would read
        // nothing and move its cursor past the range it was meant to fetch.
        appendFrames.mockRejectedValue(new Error('the archive would not take it'));

        await expect(archive.appendFrames({
            instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, frames: [buildFrame(1_000)],
        })).rejects.toThrow();
        expect(written).toEqual([]);
    });

    it('announces a gap too, which is a change a reader has to be told about', async () => {
        await archive.recordGap({
            instrumentSymbol: 'ETHUSDT',
            gap: { gapStartedAtMs: 1, gapEndedAtMs: 2, gapReason: 'the stream dropped' },
        });

        expect(written).toEqual(['ETHUSDT']);
    });

    it('stays out of the way of everything else it wraps', async () => {
        await archive.appendTradeClusters({
            instrumentSymbol: 'BTCUSDT', priceBucketSize: 10, clusters: [],
        });

        // Executions ride along with the frames that bound them; announcing
        // them separately would send a reader back for a range it just read.
        expect(written).toEqual([]);
    });
});
