import { type LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import { floorToInterval } from '../../shared/core/price-bucket.ts';
import type { LiquidityArchiveService } from '../../database/services/liquidity-archive-service.ts';
import type { ExecutedTrade } from '../core/depth-types.ts';
import type { OrderBookService } from '../core/order-book-service.ts';
import { ArchiveWriteBuffer } from './archive-write-buffer.ts';
import { buildLiquidityFrame } from '../core/depth-ladder-builder.ts';
import { TradeClusterAccumulator } from '../core/trade-cluster-accumulator.ts';

/**
 * Fires each frame slightly after its grid instant.
 *
 * Timers are allowed to fire marginally early, and an early tick would floor
 * onto the previous instant and duplicate a frame that was already recorded.
 */
const GRID_SETTLE_MS = 5;

export interface LiquidityRecorderServiceConfig {
    readonly orderBook: OrderBookService;
    readonly archive: LiquidityArchiveService;
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
 *
 * Owns the honesty of that history: every instant the book was unusable, and
 * every batch lost to a database that would not take it, is written back as an
 * explicit gap rather than left for the renderer to interpolate across.
 */
export class LiquidityRecorderService {
    private readonly config: LiquidityRecorderServiceConfig;
    private readonly writeBuffer: ArchiveWriteBuffer;
    private readonly tradeClusters: TradeClusterAccumulator;

    private frameTimer: NodeJS.Timeout | null = null;
    private flushTimer: NodeJS.Timeout | null = null;
    private isRunning = false;
    private lastFrameAtMs: number | null = null;
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
        this.flushTimer.unref();
        this.scheduleNextFrame();
    }

    /**
     * Stops the frame loop and writes out whatever is still queued.
     *
     * Any gap still open is deliberately left open: it ends when a later run
     * records its first frame, which is the only instant that closes it truthfully.
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
     * Records that recording was interrupted, with a specific cause.
     *
     * @param reason - What interrupted it, kept for the gap record.
     */
    noteInterruption(reason: string): void {
        if (this.openGapStartedAtMs === null) {
            this.openGapStartedAtMs = this.lastFrameAtMs ?? Date.now();
            this.openGapReason = reason;
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
        this.frameTimer.unref();
    }

    private handleFrameDue(): void {
        this.captureFrame();
        this.scheduleNextFrame();
    }

    private captureFrame(): void {
        const capturedAtMs = floorToInterval(Date.now(), this.config.frameIntervalMs);
        if (this.lastFrameAtMs !== null && capturedAtMs <= this.lastFrameAtMs) {
            return;
        }

        const reading = this.config.orderBook.readBook();
        if (reading === null) {
            this.noteInterruption('order book unavailable');
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
        this.lastFrameAtMs = capturedAtMs;

        if (this.writeBuffer.pendingFrameCount >= this.config.framesPerFlush) {
            void this.writeBuffer.flush();
        }
    }

    /**
     * Files the gap that just ended, and forgets it only once it is queued.
     *
     * Queued rather than written here: a gap almost always ends because the
     * archive came back, and an attempt made at that instant can still fail. The
     * old code cleared its own memory of the gap before the write and reported a
     * failure to a log nobody reads, which turned a recorded hole into a silent
     * one — the single outcome this project exists to avoid.
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
