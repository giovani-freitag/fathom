import { beforeEach, describe, expect, it } from 'vitest';
import { ArchiveWriteBuffer } from '../../../src/workers/services/archive-write-buffer.ts';
import type { TradeCluster } from '../../../src/shared/core/trade-cluster.ts';
import { createMockLiquidityArchive, type MockLiquidityArchive } from '../../mocks/liquidity-archive.ts';

const MAXIMUM_BUFFERED_CLUSTERS = 3;

interface Harness {
    readonly buffer: ArchiveWriteBuffer;
    readonly archive: MockLiquidityArchive;
    readonly writeFailures: string[];
}

function buildHarness(): Harness {
    const archive = createMockLiquidityArchive();
    const writeFailures: string[] = [];

    const buffer = new ArchiveWriteBuffer({
        archive,
        instrumentSymbol: 'BTCUSDT',
        priceBucketSize: 1,
        maximumBufferedTradeClusters: MAXIMUM_BUFFERED_CLUSTERS,
        onWriteFailed: (reason: string) => { writeFailures.push(reason); },
    });

    return { buffer, archive, writeFailures };
}

function buildCluster(executedAtMs: number): TradeCluster {
    return {
        executedAtMs,
        priceBucketIndex: 100,
        buyQuantity: 1,
        sellQuantity: 0,
        tradeCount: 1,
        largestTradeQuantity: 1,
    };
}

describe('ArchiveWriteBuffer', () => {
    let harness: Harness;

    beforeEach(() => { harness = buildHarness(); });

    it('asks nothing of the archive when nothing is queued', async () => {
        const harness = buildHarness();

        await harness.buffer.flush();

        expect(harness.archive.appendTradeClusters).not.toHaveBeenCalled();
    });

    it('says why a write did not land', async () => {
        harness.archive.appendTradeClusters.mockRejectedValueOnce(new Error('connection reset'));
        harness.buffer.enqueueTradeClusters([buildCluster(1_000)]);

        await harness.buffer.flush();

        expect(harness.writeFailures).toEqual(['connection reset']);
    });

    it('gives up the oldest clusters once the backlog outgrows its bound', async () => {
        harness.archive.appendTradeClusters.mockRejectedValue(new Error('archive down'));
        for (let index = 0; index < MAXIMUM_BUFFERED_CLUSTERS + 2; index++) {
            harness.buffer.enqueueTradeClusters([buildCluster(1_000 + index)]);
        }

        await harness.buffer.flush();
        harness.archive.appendTradeClusters.mockResolvedValue(undefined);
        await harness.buffer.flush();

        expect(harness.archive.appendTradeClusters).toHaveBeenLastCalledWith({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 1,
            clusters: [buildCluster(1_002), buildCluster(1_003), buildCluster(1_004)],
        });
    });

    it('writes each gap on its own so one refusal does not bury the rest', async () => {
        harness.archive.recordGap.mockRejectedValueOnce(new Error('archive down'));
        harness.buffer.enqueueGap({ gapStartedAtMs: 1, gapEndedAtMs: 2, gapReason: 'first' });
        harness.buffer.enqueueGap({ gapStartedAtMs: 3, gapEndedAtMs: 4, gapReason: 'second' });

        await harness.buffer.flush();

        expect(harness.buffer.pendingGapCount).toBe(1);
    });

    it('folds a gap that carries on from the one before it', async () => {
        // The archive being down produces one gap per flush, for as long as it
        // stays down. Kept apart they grow without bound, and every flush retries
        // the whole backlog one statement at a time.
        harness.buffer.enqueueGap({ gapStartedAtMs: 1_000, gapEndedAtMs: 2_000, gapReason: 'archive down' });
        harness.buffer.enqueueGap({ gapStartedAtMs: 2_000, gapEndedAtMs: 3_000, gapReason: 'archive down' });

        await harness.buffer.flush();

        expect(harness.archive.recordGap).toHaveBeenCalledTimes(1);
    });

    it('files the folded gap as one stretch of missing time', async () => {
        harness.buffer.enqueueGap({ gapStartedAtMs: 1_000, gapEndedAtMs: 2_000, gapReason: 'archive down' });
        harness.buffer.enqueueGap({ gapStartedAtMs: 2_000, gapEndedAtMs: 3_000, gapReason: 'archive down' });

        await harness.buffer.flush();

        expect(harness.archive.recordGap).toHaveBeenCalledWith({
            instrumentSymbol: 'BTCUSDT',
            gap: { gapStartedAtMs: 1_000, gapEndedAtMs: 3_000, gapReason: 'archive down' },
        });
    });

    it('keeps a gap that broke off for a different reason', async () => {
        harness.buffer.enqueueGap({ gapStartedAtMs: 1_000, gapEndedAtMs: 2_000, gapReason: 'archive down' });
        harness.buffer.enqueueGap({ gapStartedAtMs: 2_000, gapEndedAtMs: 3_000, gapReason: 'order book unavailable' });

        await harness.buffer.flush();

        expect(harness.archive.recordGap).toHaveBeenCalledTimes(2);
    });

    it('keeps a gap with recorded time between it and the one before', async () => {
        harness.buffer.enqueueGap({ gapStartedAtMs: 1_000, gapEndedAtMs: 2_000, gapReason: 'archive down' });
        harness.buffer.enqueueGap({ gapStartedAtMs: 9_000, gapEndedAtMs: 9_500, gapReason: 'archive down' });

        await harness.buffer.flush();

        expect(harness.archive.recordGap).toHaveBeenCalledTimes(2);
    });

    it('writes what was queued while a flush was already running', async () => {
        // A flush spliced its work off before this call, so waiting for it is not
        // the same as having written what is queued now — and the flush at
        // shutdown is the one that has no next chance.
        const { promise, resolve } = Promise.withResolvers<void>();
        harness.archive.appendTradeClusters.mockReturnValueOnce(promise);
        harness.buffer.enqueueTradeClusters([buildCluster(1_000)]);
        const runningFlush = harness.buffer.flush();

        harness.buffer.enqueueTradeClusters([buildCluster(2_000)]);
        const shutdownFlush = harness.buffer.flush();
        resolve();
        await Promise.all([runningFlush, shutdownFlush]);

        const written = harness.archive.appendTradeClusters.mock.calls
            .flatMap(([request]) => [...(request as { clusters: readonly unknown[] }).clusters]);
        expect(written).toEqual([buildCluster(1_000), buildCluster(2_000)]);
    });
});
