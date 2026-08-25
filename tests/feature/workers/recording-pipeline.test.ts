import type { LiquidityArchiveService } from '../../../src/database/services/liquidity-archive-service.ts';
import type { RecordingGap } from '../../../src/shared/core/recording-gap.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidityRecorderService } from '../../../src/workers/services/liquidity-recorder-service.ts';
import { OrderBookService } from '../../../src/workers/core/order-book-service.ts';
import { buildDiff, createSnapshotSource } from '../../mocks/depth-fixtures.ts';

const FRAME_INTERVAL_MS = 1_000;

/** Shape the recorder hands `recordGap`, so a spy call can be read typed. */
type GapRecordCall = [{ readonly gap: RecordingGap }];

interface ArchiveSpy {
    readonly archive: LiquidityArchiveService;
    readonly appendFrames: ReturnType<typeof vi.fn>;
    readonly appendTradeClusters: ReturnType<typeof vi.fn>;
    readonly recordGap: ReturnType<typeof vi.fn>;
    readonly findLastFrameTimestamp: ReturnType<typeof vi.fn>;
}

function createArchiveSpy(lastFrameMs: number | null = null): ArchiveSpy {
    const appendFrames = vi.fn().mockResolvedValue(undefined);
    const appendTradeClusters = vi.fn().mockResolvedValue(undefined);
    const recordGap = vi.fn().mockResolvedValue(undefined);
    const findLastFrameTimestamp = vi.fn().mockResolvedValue(lastFrameMs);
    const registerInstrument = vi.fn().mockResolvedValue(undefined);

    return {
        archive: {
            appendFrames,
            appendTradeClusters,
            recordGap,
            findLastFrameTimestamp,
            registerInstrument,
        } as unknown as LiquidityArchiveService,
        appendFrames,
        appendTradeClusters,
        recordGap,
        findLastFrameTimestamp,
    };
}

interface Pipeline {
    readonly orderBook: OrderBookService;
    readonly recorder: LiquidityRecorderService;
    readonly spy: ArchiveSpy;
    readonly statuses: string[];
}

function buildPipeline(lastFrameMs: number | null = null): Pipeline {
    const source = createSnapshotSource(100);
    const spy = createArchiveSpy(lastFrameMs);
    const statuses: string[] = [];

    const orderBook = new OrderBookService({
        fetchDepthSnapshot: source.fetchDepthSnapshot,
        retainedPriceRangeRatio: 0.5,
        deepRepairIntervalMs: 3_600_000,
        snapshotRetryDelayMs: 10,
        onDesynchronized: () => undefined,
        onSynchronized: () => undefined,
    });

    const recorder = new LiquidityRecorderService({
        orderBook,
        archive: spy.archive,
        instrumentSymbol: 'BTCUSDT',
        priceBucketSize: 1,
        frameIntervalMs: FRAME_INTERVAL_MS,
        recordedPriceRangeRatio: 0.5,
        flushIntervalMs: 500,
        framesPerFlush: 1,
        maximumBufferedFrames: 100,
        maximumBufferedTradeClusters: 1_000,
        onStatusChanged: (status) => statuses.push(status),
    });

    return { orderBook, recorder, spy, statuses };
}

/** Brings the mirrored book up, exactly as a live connection would. */
async function synchronize(pipeline: Pipeline): Promise<void> {
    pipeline.orderBook.start();
    pipeline.orderBook.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
    await vi.waitFor(() => expect(pipeline.orderBook.isSynchronized).toBe(true));
}

describe('recording pipeline', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true, now: 10_000 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('turns a synchronised book into recorded frames', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);

        await vi.advanceTimersByTimeAsync(2_500);
        await pipeline.recorder.stop();

        expect(pipeline.spy.appendFrames).toHaveBeenCalled();
    });

    it('lands frames on whole grid instants', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);

        await vi.advanceTimersByTimeAsync(3_500);
        await pipeline.recorder.stop();

        const frames = pipeline.spy.appendFrames.mock.calls.flatMap(
            (call) => (call[0] as { frames: { capturedAtMs: number }[] }).frames,
        );
        expect(frames.every((frame) => frame.capturedAtMs % FRAME_INTERVAL_MS === 0)).toBe(true);
    });

    it('separates resting bids from resting asks', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);

        await vi.advanceTimersByTimeAsync(1_500);
        await pipeline.recorder.stop();

        const frame = pipeline.spy.appendFrames.mock.calls[0]?.[0] as {
            frames: { bids: { quantities: Float32Array }; asks: { quantities: Float32Array } }[];
        };
        const first = frame.frames[0]!;
        expect([
            [...first.bids.quantities].reduce((a, b) => a + b, 0),
            [...first.asks.quantities].reduce((a, b) => a + b, 0),
        ]).toEqual([9, 6]);
    });

    it('bins executions onto the same grid as the frames', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);

        pipeline.recorder.ingestTrade({
            executedAtMs: 10_100,
            price: 100,
            quantity: 2,
            isAggressorSelling: false,
        });
        await vi.advanceTimersByTimeAsync(3_500);
        await pipeline.recorder.stop();

        const clusters = pipeline.spy.appendTradeClusters.mock.calls.flatMap(
            (call) => (call[0] as { clusters: { executedAtMs: number; buyQuantity: number }[] }).clusters,
        );
        expect(clusters.some((cluster) => cluster.executedAtMs === 10_000 && cluster.buyQuantity === 2))
            .toBe(true);
    });

    it('records nothing while the book is unusable', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();

        await vi.advanceTimersByTimeAsync(3_500);
        await pipeline.recorder.stop();

        expect(pipeline.spy.appendFrames).not.toHaveBeenCalled();
    });

    it('keeps a gap whose first write failed, instead of forgetting it', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);
        await vi.advanceTimersByTimeAsync(2_500);
        pipeline.orderBook.invalidate('socket closed');
        await vi.advanceTimersByTimeAsync(2_500);
        // The archive is unreachable at the exact moment the gap closes, which
        // is the usual case: the gap existed because the archive was down.
        pipeline.spy.recordGap.mockRejectedValueOnce(new Error('archive down'));

        pipeline.orderBook.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
        await vi.waitFor(() => expect(pipeline.orderBook.isSynchronized).toBe(true));
        await vi.advanceTimersByTimeAsync(3_000);
        await pipeline.recorder.stop();

        expect(pipeline.spy.recordGap.mock.calls.length).toBeGreaterThan(1);
    });

    it('files the retried gap with the same boundaries it first had', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);
        await vi.advanceTimersByTimeAsync(2_500);
        pipeline.orderBook.invalidate('socket closed');
        await vi.advanceTimersByTimeAsync(2_500);
        pipeline.spy.recordGap.mockRejectedValueOnce(new Error('archive down'));

        pipeline.orderBook.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
        await vi.waitFor(() => expect(pipeline.orderBook.isSynchronized).toBe(true));
        await vi.advanceTimersByTimeAsync(3_000);
        await pipeline.recorder.stop();

        const calls = pipeline.spy.recordGap.mock.calls as GapRecordCall[];
        expect(calls[1]?.[0].gap).toEqual(calls[0]?.[0].gap);
    });

    it('closes the gap left by a previous run once recording resumes', async () => {
        const pipeline = buildPipeline(5_000);
        await pipeline.recorder.start();
        await synchronize(pipeline);

        await vi.advanceTimersByTimeAsync(2_500);
        await pipeline.recorder.stop();

        expect(pipeline.spy.recordGap).toHaveBeenCalledWith(
            expect.objectContaining({
                gap: expect.objectContaining({ gapReason: 'collector was not running' }),
            }),
        );
    });

    it('opens no gap when the previous run stopped moments ago', async () => {
        const pipeline = buildPipeline(9_500);
        await pipeline.recorder.start();
        await synchronize(pipeline);

        await vi.advanceTimersByTimeAsync(2_500);
        await pipeline.recorder.stop();

        expect(pipeline.spy.recordGap).not.toHaveBeenCalled();
    });

    it('records a gap covering an interruption mid-session', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);
        await vi.advanceTimersByTimeAsync(2_500);

        pipeline.orderBook.invalidate('socket closed');
        await vi.advanceTimersByTimeAsync(2_500);
        pipeline.orderBook.ingestDiff(buildDiff({ firstUpdateId: 95, finalUpdateId: 105 }));
        await vi.waitFor(() => expect(pipeline.orderBook.isSynchronized).toBe(true));
        await vi.advanceTimersByTimeAsync(2_500);
        await pipeline.recorder.stop();

        expect(pipeline.spy.recordGap).toHaveBeenCalled();
    });

    it('keeps a failed batch queued rather than losing those seconds', async () => {
        const pipeline = buildPipeline();
        pipeline.spy.appendFrames.mockRejectedValue(new Error('archive unavailable'));
        await pipeline.recorder.start();
        await synchronize(pipeline);

        await vi.advanceTimersByTimeAsync(3_500);
        await pipeline.recorder.stop();

        expect(pipeline.statuses.some((status) => status.includes('data stays queued'))).toBe(true);
    });

    it('does not restate the same instant after a restart', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);

        await vi.advanceTimersByTimeAsync(4_500);
        await pipeline.recorder.stop();

        const instants = pipeline.spy.appendFrames.mock.calls.flatMap(
            (call) => (call[0] as { frames: { capturedAtMs: number }[] }).frames.map((f) => f.capturedAtMs),
        );
        expect(new Set(instants).size).toBe(instants.length);
    });
});
