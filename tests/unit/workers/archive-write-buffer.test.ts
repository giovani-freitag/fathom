import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ArchiveWriteBuffer } from '../../../src/workers/services/archive-write-buffer.ts';
import type { LiquidityFrame } from '../../../src/shared/core/liquidity-frame.ts';
import type { TradeCluster } from '../../../src/shared/core/trade-cluster.ts';
import { createMockLiquidityArchive, type MockLiquidityArchive } from '../../mocks/liquidity-archive.ts';

const MAXIMUM_BUFFERED_FRAMES = 3;
const MAXIMUM_BUFFERED_CLUSTERS = 3;

interface Harness {
    readonly buffer: ArchiveWriteBuffer;
    readonly archive: MockLiquidityArchive;
    readonly writeFailures: string[];
    readonly onFramesDropped: Mock<(droppedFrames: readonly LiquidityFrame[]) => void>;
}

function buildHarness(): Harness {
    const archive = createMockLiquidityArchive();
    const writeFailures: string[] = [];
    const onFramesDropped: Mock<(droppedFrames: readonly LiquidityFrame[]) => void> = vi.fn();

    const buffer = new ArchiveWriteBuffer({
        archive,
        instrumentSymbol: 'BTCUSDT',
        priceBucketSize: 1,
        maximumBufferedFrames: MAXIMUM_BUFFERED_FRAMES,
        maximumBufferedTradeClusters: MAXIMUM_BUFFERED_CLUSTERS,
        onWriteFailed: (reason) => { writeFailures.push(reason); },
        onFramesDropped,
    });

    return { buffer, archive, writeFailures, onFramesDropped };
}

function buildFrame(capturedAtMs: number): LiquidityFrame {
    return {
        capturedAtMs,
        bestBidPrice: 100,
        bestAskPrice: 101,
        bids: { lowestBucketIndex: 100, quantities: Float32Array.from([5]) },
        asks: { lowestBucketIndex: 101, quantities: Float32Array.from([6]) },
    };
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

/** Every frame the buffer reported giving up, across every drop. */
function readDroppedFrames(harness: Harness): LiquidityFrame[] {
    return harness.onFramesDropped.mock.calls.flatMap(([droppedFrames]) => [...droppedFrames]);
}

/** Every frame the archive was handed, across every accepted write. */
function readWrittenFrames(archive: MockLiquidityArchive): LiquidityFrame[] {
    return archive.appendFrames.mock.calls.flatMap(([request]) => [...request.frames]);
}

describe('ArchiveWriteBuffer', () => {
    let harness: Harness;

    beforeEach(() => { harness = buildHarness(); });

    it('writes what was queued under the instrument it belongs to', async () => {
        harness.buffer.enqueueFrame(buildFrame(1_000));

        await harness.buffer.flush();

        expect(harness.archive.appendFrames).toHaveBeenCalledWith({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 1,
            frames: [buildFrame(1_000)],
        });
    });

    it('asks nothing of the archive when nothing is queued', async () => {
        await harness.buffer.flush();

        expect(harness.archive.appendFrames).not.toHaveBeenCalled();
    });

    it('keeps a frame the archive refused', async () => {
        harness.archive.appendFrames.mockRejectedValueOnce(new Error('connection reset'));
        harness.buffer.enqueueFrame(buildFrame(1_000));

        await harness.buffer.flush();

        expect(harness.buffer.pendingFrameCount).toBe(1);
    });

    it('writes a refused frame on the next flush', async () => {
        harness.archive.appendFrames.mockRejectedValueOnce(new Error('connection reset'));
        harness.buffer.enqueueFrame(buildFrame(1_000));
        await harness.buffer.flush();

        await harness.buffer.flush();

        expect(harness.archive.appendFrames).toHaveBeenLastCalledWith({
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 1,
            frames: [buildFrame(1_000)],
        });
    });

    it('says why a write did not land', async () => {
        harness.archive.appendFrames.mockRejectedValueOnce(new Error('connection reset'));
        harness.buffer.enqueueFrame(buildFrame(1_000));

        await harness.buffer.flush();

        expect(harness.writeFailures).toEqual(['connection reset']);
    });

    it('gives up the oldest frames once the backlog outgrows its bound', async () => {
        // An archive that stays down would otherwise grow the backlog until the
        // collector runs out of memory and stops recording altogether.
        harness.archive.appendFrames.mockRejectedValue(new Error('archive down'));
        for (let index = 0; index < MAXIMUM_BUFFERED_FRAMES + 2; index++) {
            harness.buffer.enqueueFrame(buildFrame(1_000 + index));
        }

        await harness.buffer.flush();

        expect(harness.buffer.pendingFrameCount).toBe(MAXIMUM_BUFFERED_FRAMES);
    });

    it('names the frames it gave up, oldest first', async () => {
        harness.archive.appendFrames.mockRejectedValue(new Error('archive down'));
        for (let index = 0; index < MAXIMUM_BUFFERED_FRAMES + 2; index++) {
            harness.buffer.enqueueFrame(buildFrame(1_000 + index));
        }

        await harness.buffer.flush();

        expect(readDroppedFrames(harness)).toEqual([buildFrame(1_000), buildFrame(1_001)]);
    });

    it('reports no drop at all while the backlog is within its bound', async () => {
        // Reported as a drop of nothing, a healthy backlog reads in the log as
        // recording loss that never happened.
        harness.archive.appendFrames.mockRejectedValue(new Error('archive down'));
        harness.buffer.enqueueFrame(buildFrame(1_000));

        await harness.buffer.flush();

        expect(harness.onFramesDropped).not.toHaveBeenCalled();
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
        harness.archive.appendFrames.mockReturnValueOnce(promise);
        harness.buffer.enqueueFrame(buildFrame(1_000));
        const runningFlush = harness.buffer.flush();

        harness.buffer.enqueueFrame(buildFrame(2_000));
        const shutdownFlush = harness.buffer.flush();
        resolve();
        await Promise.all([runningFlush, shutdownFlush]);

        expect(readWrittenFrames(harness.archive)).toEqual([buildFrame(1_000), buildFrame(2_000)]);
    });
});
