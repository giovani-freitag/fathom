import type { LiquidityArchiveService } from '../../../src/database/services/liquidity-archive-service.ts';
import type { RecordingGap } from '../../../src/shared/core/recording-gap.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidityRecorderService } from '../../../src/workers/services/liquidity-recorder-service.ts';
import type { LiquidityFrame } from '../../../src/shared/core/liquidity-frame.ts';
import { OrderBookService } from '../../../src/workers/core/order-book-service.ts';
import { buildDiff, createSnapshotSource } from '../../mocks/depth-fixtures.ts';

const FRAME_INTERVAL_MS = 1_000;
/** The grid the whole-book framing records on, which the collector holds still. */
const WIDE_BUCKET_SIZE = 100;

/** One clean turn of the recording clock, landing exactly on its own grid. */
async function tick(pipeline: { readonly recorder: LiquidityRecorderService }): Promise<void> {
    void pipeline;
    await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
}

/** Every cause the recorder filed, in the order it filed them. */
function filedReasons(pipeline: { readonly spy: ArchiveSpy }): string[] {
    return (pipeline.spy.recordGap.mock.calls as GapRecordCall[]).map((call) => call[0].gap.gapReason);
}

/** Shape the recorder hands `recordGap`, so a spy call can be read typed. */
type GapRecordCall = [{ readonly gap: RecordingGap }];

interface ArchiveSpy {
    readonly archive: LiquidityArchiveService;
    readonly appendFrames: ReturnType<typeof vi.fn>;
    readonly appendTradeClusters: ReturnType<typeof vi.fn>;
    readonly recordGap: ReturnType<typeof vi.fn>;
    readonly findLastFrameTimestamp: ReturnType<typeof vi.fn>;
    readonly close: ReturnType<typeof vi.fn>;
}

function createArchiveSpy(lastFrameMs: number | null = null): ArchiveSpy {
    const appendFrames = vi.fn().mockResolvedValue(undefined);
    const appendTradeClusters = vi.fn().mockResolvedValue(undefined);
    const recordGap = vi.fn().mockResolvedValue(undefined);
    const findLastFrameTimestamp = vi.fn().mockResolvedValue(lastFrameMs);
    const registerInstrument = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);

    return {
        archive: {
            appendFrames,
            appendTradeClusters,
            recordGap,
            findLastFrameTimestamp,
            registerInstrument,
            open,
            close,
        } as unknown as LiquidityArchiveService,
        appendFrames,
        appendTradeClusters,
        recordGap,
        findLastFrameTimestamp,
        close,
    };
}

interface Pipeline {
    readonly orderBook: OrderBookService;
    readonly recorder: LiquidityRecorderService;
    readonly spy: ArchiveSpy;
    readonly statuses: string[];
    /** Every wide instant handed on, with the grid it was laid on. */
    readonly wide: { frame: unknown; priceBucketSize: number }[];
}

function buildPipeline(lastFrameMs: number | null = null): Pipeline {
    const source = createSnapshotSource(100);
    const spy = createArchiveSpy(lastFrameMs);
    const statuses: string[] = [];
    const wide: { frame: unknown; priceBucketSize: number }[] = [];

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
        wideRecordings: [{
            priceRangeRatio: 1,
            resolveBucketSize: () => WIDE_BUCKET_SIZE,
            intervalMs: FRAME_INTERVAL_MS,
            combine: 'largest' as const,
            onFrame: (frame: LiquidityFrame, priceBucketSize: number) => {
                wide.push({ frame, priceBucketSize });
            },
        }],
    });

    return { orderBook, recorder, spy, statuses, wide };
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

    it('files a gap when the recording clock skips grid instants', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);
        await vi.advanceTimersByTimeAsync(2_500);

        // The host stops running us on schedule — a throttled tab, a slept
        // machine — while the socket keeps the book perfectly synchronized.
        vi.setSystemTime(Date.now() + 30_000);
        await vi.advanceTimersByTimeAsync(2_500);
        await pipeline.recorder.stop();

        expect(pipeline.spy.recordGap).toHaveBeenCalledWith(
            expect.objectContaining({
                gap: expect.objectContaining({ gapReason: 'the recording clock did not fire on time' }),
            }),
        );
    });

    it('calls the seconds before the first book a start, not a loss', async () => {
        // A run opens with the mirror still being built. An operator counting
        // faults should not be counting these.
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await tick(pipeline);
        await synchronize(pipeline);
        await tick(pipeline);
        await pipeline.recorder.stop();

        expect(filedReasons(pipeline)).toContain('waiting for the first order book');
    });

    it('lets a real cause explain a start that never finished', async () => {
        // The socket can fail while the first mirror is still being built. That
        // gap is not "we were starting" — it is the reason the start failed,
        // and a start explains no more than a missing book does.
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await tick(pipeline);

        pipeline.recorder.noteInterruption('waiting for the first order book');
        pipeline.recorder.noteInterruption('socket closed');
        await synchronize(pipeline);
        await tick(pipeline);
        await pipeline.recorder.stop();

        expect(filedReasons(pipeline)).toEqual(['socket closed']);
    });

    it('files the cause it was told, not the one it guessed', async () => {
        // The clock ticks once a second and the book goes unusable the instant
        // it breaks, so the recorder almost always notices before it is told
        // why. First writer wins would stamp "the book was not there" over
        // every socket close, and the ledger would answer the one question it
        // exists to answer with a restatement of the question.
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);
        await tick(pipeline);

        pipeline.recorder.noteInterruption('order book unavailable');
        pipeline.recorder.noteInterruption('no inbound traffic within the silence timeout');
        await tick(pipeline);
        await pipeline.recorder.stop();

        expect(filedReasons(pipeline)).toContain('no inbound traffic within the silence timeout');
    });

    it('keeps the first real cause when a second one follows it', async () => {
        // Two explanations for one hole is one explanation too many, and the
        // one that broke it came first.
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);
        await tick(pipeline);

        pipeline.recorder.noteInterruption('socket closed');
        pipeline.recorder.noteInterruption('no inbound traffic within the silence timeout');
        await tick(pipeline);
        await pipeline.recorder.stop();

        expect(filedReasons(pipeline)).not.toContain('no inbound traffic within the silence timeout');
    });

    it('starts a gap after the last recorded second, not on it', async () => {
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

        const calls = pipeline.spy.recordGap.mock.calls as GapRecordCall[];
        const gap = calls[0]![0].gap;
        expect(gap.gapStartedAtMs % FRAME_INTERVAL_MS).toBe(0);
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

describe('recording pipeline framing the far field', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true, now: 10_000 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('frames the same instants the near recording does', async () => {
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);

        await vi.advanceTimersByTimeAsync(2_500);
        await pipeline.recorder.stop();

        expect(pipeline.wide.length).toBeGreaterThan(0);
    });

    it('lays it on the grid the framing declared, not on one of its own', async () => {
        // A row in dollars cannot be right for two contracts at once: a
        // thousand of them is one percent of Bitcoin and the whole of Litecoin.
        // Which grid the far field lands on belongs to the framing, and the
        // recording hands it through untouched.
        const pipeline = buildPipeline();
        await pipeline.recorder.start();
        await synchronize(pipeline);

        await vi.advanceTimersByTimeAsync(2_500);
        await pipeline.recorder.stop();

        expect(pipeline.wide.at(-1)?.priceBucketSize).toBe(WIDE_BUCKET_SIZE);
    });
});

describe('recording pipeline framing the far field more than once', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true, now: 10_000 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('offers the same instant to every framing that asked for one', async () => {
        // Two readings want the whole book at different heights: one coarse
        // enough to be free, one on the contract's own grid.
        const coarse: number[] = [];
        const fine: number[] = [];
        const pipeline = buildPipeline();
        const recorder = new LiquidityRecorderService({
            orderBook: pipeline.orderBook,
            archive: pipeline.spy.archive,
            instrumentSymbol: 'BTCUSDT',
            priceBucketSize: 1,
            frameIntervalMs: FRAME_INTERVAL_MS,
            recordedPriceRangeRatio: 0.5,
            flushIntervalMs: 500,
            framesPerFlush: 1,
            maximumBufferedFrames: 100,
            maximumBufferedTradeClusters: 1_000,
            onStatusChanged: () => undefined,
            wideRecordings: [
                {
                    priceRangeRatio: 1,
                    resolveBucketSize: () => 50,
                    intervalMs: FRAME_INTERVAL_MS,
                    combine: 'largest' as const,
                    onFrame: (_frame: LiquidityFrame, grid: number) => { coarse.push(grid); },
                },
                {
                    priceRangeRatio: 1,
                    resolveBucketSize: () => 1,
                    intervalMs: FRAME_INTERVAL_MS,
                    combine: 'sum' as const,
                    onFrame: (_frame: LiquidityFrame, grid: number) => { fine.push(grid); },
                },
            ],
        });

        await recorder.start();
        await synchronize(pipeline);
        await vi.advanceTimersByTimeAsync(2_500);
        await recorder.stop();

        expect([coarse.length > 0, fine.length > 0]).toEqual([true, true]);
        expect([coarse[0], fine[0]]).toEqual([50, 1]);
    });
});
