import { releaseTimerFromEventLoop, type TimerHandle } from '../../shared/core/timers.ts';
import { type LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import { floorToInterval } from '../../shared/core/price-bucket.ts';
import type { LiquidityArchive } from '../../database/services/liquidity-archive.ts';
import type { ExecutedTrade } from '../core/depth-types.ts';
import type { OrderBookService } from '../core/order-book-service.ts';

/**
 * The cause the recorder can give on its own: none.
 *
 * It sees that the book is not there; it does not see why. Anything that knows
 * why says so afterwards, and that is what the gap should end up carrying.
 */
const BOOK_UNAVAILABLE = 'order book unavailable';
import { ArchiveWriteBuffer } from './archive-write-buffer.ts';
import { buildLiquidityFrame } from '../core/depth-ladder-builder.ts';
import { TradeClusterAccumulator } from '../core/trade-cluster-accumulator.ts';

/**
 * Fires each frame slightly after its grid instant.
 */
const GRID_SETTLE_MS = 5;

export interface LiquidityRecorderServiceConfig {
    readonly orderBook: OrderBookService;
    readonly archive: LiquidityArchive;
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
    readonly recordedPriceRangeRatio: number;
    readonly flushIntervalMs: number;
    readonly framesPerFlush: number;
    readonly maximumBufferedFrames: number;
    readonly maximumBufferedTradeClusters: number;
    readonly onStatusChanged: (status: string) => void;
}

/**
 * Turns the live book into recorded history on a fixed grid.
 */
export class LiquidityRecorderService {
    private readonly config: LiquidityRecorderServiceConfig;
    private readonly writeBuffer: ArchiveWriteBuffer;
    private readonly tradeClusters: TradeClusterAccumulator;

    private frameTimer: TimerHandle | null = null;
    private flushTimer: TimerHandle | null = null;
    private isRunning = false;
    private lastCapturedAtMs: number | null = null;

    /** When the recording clock last produced a frame, or null before the first. */
    get lastFrameAtMs(): number | null {
        return this.lastCapturedAtMs;
    }


    private openGapStartedAtMs: number | null = null;
    private openGapReason = '';

    constructor(config: LiquidityRecorderServiceConfig) {
        this.config = config;
        this.tradeClusters = new TradeClusterAccumulator({
            priceBucketSize: config.priceBucketSize,
            frameIntervalMs: config.frameIntervalMs,
        });
        this.writeBuffer = new ArchiveWriteBuffer({
            archive: config.archive,
            instrumentSymbol: config.instrumentSymbol,
            priceBucketSize: config.priceBucketSize,
            maximumBufferedFrames: config.maximumBufferedFrames,
            maximumBufferedTradeClusters: config.maximumBufferedTradeClusters,
            onWriteFailed: this.handleWriteFailure.bind(this),
            onFramesDropped: this.handleFramesDropped.bind(this),
        });

        this.handleFrameDue = this.handleFrameDue.bind(this);
        this.handleFlushDue = this.handleFlushDue.bind(this);
    }

    /**
     * Registers the instrument, reopens any gap left by the previous run, and
     * starts the frame loop.
     *
     * @throws PostgresQueryError when the archive cannot be reached at startup.
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            throw new Error('This recorder is already running');
        }
        this.isRunning = true;

        await this.config.archive.registerInstrument({
            instrumentSymbol: this.config.instrumentSymbol,
            priceBucketSize: this.config.priceBucketSize,
            frameIntervalMs: this.config.frameIntervalMs,
        });

        await this.reopenGapFromPreviousRun();

        this.flushTimer = setInterval(this.handleFlushDue, this.config.flushIntervalMs);
        releaseTimerFromEventLoop(this.flushTimer);
        this.scheduleNextFrame();
    }

    /**
     * Stops the frame loop and writes out whatever is still queued.
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        for (const timer of [this.frameTimer, this.flushTimer]) {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
        this.frameTimer = null;
        this.flushTimer = null;
        await this.writeBuffer.flush();
    }

    /**
     * Folds one execution into the current time and price cell.
     *
     * @param trade - The execution, with the venue's own timestamp.
     */
    ingestTrade(trade: ExecutedTrade): void {
        this.tradeClusters.add(trade);
    }

    /**
     * Records that recording was interrupted, with a cause.
     *
     * A cause that explains something replaces one that does not. The clock
     * ticks once a second and the book goes unusable the instant it breaks, so
     * the recorder almost always *notices* before it is *told why*: first-writer
     * wins would stamp "the book was not there" over every socket close, every
     * silence timeout and every reconnect, and the ledger would answer the one
     * question it exists to answer with a restatement of the question.
     *
     * @param reason - What interrupted it, kept for the gap record.
     */
    noteInterruption(reason: string): void {
        if (this.openGapStartedAtMs === null) {
            // One interval past the last frame, because that frame was recorded.
            // Starting at it would claim a second that exists is missing, and
            // would disagree with how a gap left by a previous run is reopened.
            this.openGapStartedAtMs = this.lastCapturedAtMs === null
                ? Date.now()
                : this.lastCapturedAtMs + this.config.frameIntervalMs;
            this.openGapReason = reason;
            return;
        }

        if (this.openGapReason === BOOK_UNAVAILABLE && reason !== BOOK_UNAVAILABLE) {
            this.openGapReason = reason;
        }
    }

    /**
     * Opens a gap when the recording clock missed one or more grid instants.
     *
     * @param capturedAtMs - The instant this capture is filing under.
     */
    private noteSkippedInstants(capturedAtMs: number): void {
        if (this.lastCapturedAtMs === null) {
            return;
        }
        if (capturedAtMs > this.lastCapturedAtMs + this.config.frameIntervalMs) {
            this.noteInterruption('the recording clock did not fire on time');
        }
    }

    private async reopenGapFromPreviousRun(): Promise<void> {
        const lastRecordedAtMs = await this.config.archive.findLastFrameTimestamp(this.config.instrumentSymbol);
        if (lastRecordedAtMs === null) {
            return;
        }

        const downtimeMs = Date.now() - lastRecordedAtMs;
        if (downtimeMs <= this.config.frameIntervalMs * 2) {
            return;
        }

        this.openGapStartedAtMs = lastRecordedAtMs + this.config.frameIntervalMs;
        this.openGapReason = 'collector was not running';
        this.config.onStatusChanged(
            `Reopened a gap of ${Math.round(downtimeMs / 1_000)}s left by the previous run`,
        );
    }

    private scheduleNextFrame(): void {
        if (!this.isRunning) {
            return;
        }
        const nowMs = Date.now();
        const nextFrameAtMs = floorToInterval(nowMs, this.config.frameIntervalMs) + this.config.frameIntervalMs;
        this.frameTimer = setTimeout(this.handleFrameDue, nextFrameAtMs - nowMs + GRID_SETTLE_MS);
        releaseTimerFromEventLoop(this.frameTimer);
    }

    private handleFrameDue(): void {
        this.captureFrame();
        this.scheduleNextFrame();
    }

    private captureFrame(): void {
        const capturedAtMs = floorToInterval(Date.now(), this.config.frameIntervalMs);
        if (this.lastCapturedAtMs !== null && capturedAtMs <= this.lastCapturedAtMs) {
            return;
        }

        // A grid instant that never came round is unrecorded time, and nothing
        // downstream can tell it from time that was recorded as empty. The clock
        // skips whenever the host stops running us on schedule: a long collection
        // pause, a suspended machine, a tab the browser throttled to one wake a
        // minute. Noticing here is what turns silence into a drawn hole.
        this.noteSkippedInstants(capturedAtMs);

        const reading = this.config.orderBook.readBook();
        if (reading === null) {
            this.noteInterruption(BOOK_UNAVAILABLE);
            return;
        }

        this.closeOpenGap(capturedAtMs);
        this.writeBuffer.enqueueFrame(buildLiquidityFrame({
            reading,
            capturedAtMs,
            priceBucketSize: this.config.priceBucketSize,
            recordedPriceRangeRatio: this.config.recordedPriceRangeRatio,
        }));
        this.writeBuffer.enqueueTradeClusters(this.tradeClusters.drainBefore(capturedAtMs));
        this.lastCapturedAtMs = capturedAtMs;

        if (this.writeBuffer.pendingFrameCount >= this.config.framesPerFlush) {
            void this.writeBuffer.flush();
        }
    }

    /**
     * Files the gap that just ended, and forgets it only once it is queued.
     */
    private closeOpenGap(endedAtMs: number): void {
        const startedAtMs = this.openGapStartedAtMs;
        if (startedAtMs === null) {
            return;
        }

        this.writeBuffer.enqueueGap({
            gapStartedAtMs: startedAtMs,
            gapEndedAtMs: endedAtMs,
            gapReason: this.openGapReason,
        });
        this.openGapStartedAtMs = null;
    }

    private handleFlushDue(): void {
        void this.writeBuffer.flush();
    }

    private handleWriteFailure(reason: string): void {
        this.config.onStatusChanged(`Archive write failed, data stays queued: ${reason}`);
    }

    private handleFramesDropped(droppedFrames: readonly LiquidityFrame[]): void {
        const firstFrame = droppedFrames[0];
        const lastFrame = droppedFrames[droppedFrames.length - 1];
        if (firstFrame === undefined || lastFrame === undefined) {
            return;
        }

        this.config.onStatusChanged(`Dropped ${droppedFrames.length} buffered frames the archive would not take`);
        this.writeBuffer.enqueueGap({
            gapStartedAtMs: firstFrame.capturedAtMs,
            gapEndedAtMs: lastFrame.capturedAtMs,
            gapReason: 'archive unavailable, buffered frames dropped',
        });
    }
}
