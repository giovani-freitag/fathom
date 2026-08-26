import { CollectorRuntime } from '../../../src/workers/collector-runtime.ts';
import { describe, expect, it, vi } from 'vitest';
import type { LiquidityArchive } from '../../../src/database/services/liquidity-archive.ts';
import { createMockCollectorLog } from '../../mocks/collector-log.ts';
import { openSilentMarketDataSocket } from '../../mocks/market-data-socket.ts';

function createArchiveSpy() {
    const open = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);

    return {
        open,
        close,
        archive: {
            open,
            close,
            registerInstrument: vi.fn().mockResolvedValue(undefined),
            appendFrames: vi.fn().mockResolvedValue(undefined),
            appendTradeClusters: vi.fn().mockResolvedValue(undefined),
            recordGap: vi.fn().mockResolvedValue(undefined),
            findLastFrameTimestamp: vi.fn().mockResolvedValue(null),
        } as unknown as LiquidityArchive,
    };
}

function buildRuntime(archive: LiquidityArchive): CollectorRuntime {
    return new CollectorRuntime({
        configuration: {
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 10,
            frameIntervalMs: 1_000,
            recordedPriceRangeRatio: 0.02,
            retainedPriceRangeRatio: 0.1,
            deepRepairIntervalMs: 3_600_000,
        },
        openSocket: openSilentMarketDataSocket,
        archive,
        framesPerFlush: 1,
        log: createMockCollectorLog().log,
    });
}

describe('CollectorRuntime and the archive it was handed', () => {
    it('does not open it, because whoever built it already did', async () => {
        const spy = createArchiveSpy();

        await buildRuntime(spy.archive).start();

        expect(spy.open).not.toHaveBeenCalled();
    });

    it('does not close it when it stops', async () => {
        const spy = createArchiveSpy();
        const runtime = buildRuntime(spy.archive);
        await runtime.start();

        await runtime.stop();

        // A supervisor runs several of these against one archive. A runtime that
        // closed it would stop every other contract mid-write.
        expect(spy.close).not.toHaveBeenCalled();
    });

    it('still registers the instrument it is about to record', async () => {
        const spy = createArchiveSpy();

        await buildRuntime(spy.archive).start();

        expect(spy.archive.registerInstrument).toHaveBeenCalled();
    });
});
