import type { LiquidityFrame } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';
import type { LiquidityArchive } from '../../database/services/liquidity-archive.ts';
import { describeError } from '../core/collector-log.ts';

export interface ArchiveWriteBufferConfig {
    readonly archive: LiquidityArchive;
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly maximumBufferedFrames: number;
    readonly maximumBufferedTradeClusters: number;
    readonly onWriteFailed: (reason: string) => void;
    readonly onFramesDropped: (droppedFrames: readonly LiquidityFrame[]) => void;
}

/**
 * Holds recorded data until the database accepts it.
 */
export class ArchiveWriteBuffer {
    private readonly config: ArchiveWriteBufferConfig;
    private readonly pendingFrames: LiquidityFrame[] = [];
    private readonly pendingTradeClusters: TradeCluster[] = [];
    private readonly pendingGaps: RecordingGap[] = [];
    private flushInFlight: Promise<void> | null = null;

    constructor(config: ArchiveWriteBufferConfig) {
        this.config = config;
    }

    /**
     * Queues one frame for the next flush.
     *
     * @param frame - The frame to persist.
     */
    enqueueFrame(frame: LiquidityFrame): void {
        this.pendingFrames.push(frame);
    }

    /**
     * Queues aggregated executions for the next flush.
     *
     * @param clusters - The clusters to persist.
     */
    enqueueTradeClusters(clusters: readonly TradeCluster[]): void {
        this.pendingTradeClusters.push(...clusters);
    }

    /**
     * Queues a gap for the next flush.
     *
     * @param gap - The stretch of time that went unrecorded.
     */
    enqueueGap(gap: RecordingGap): void {
        // An archive that stays down produces one gap per flush, and kept apart
        // they grow without bound while every flush retries the whole backlog a
        // statement at a time. Two that meet describe one stretch of lost time.
        const previous = this.pendingGaps.at(-1);
        if (previous !== undefined && this.doesCarryOn(previous, gap)) {
            this.pendingGaps[this.pendingGaps.length - 1] = {
                ...previous,
                gapEndedAtMs: Math.max(previous.gapEndedAtMs, gap.gapEndedAtMs),
            };
            return;
        }
        this.pendingGaps.push(gap);
    }


    /**
     * Writes everything queued when it was called.
     */
    async flush(): Promise<void> {
        // A flush already running took its work off the queues before this call,
        // so waiting for it is not the same as having written what is queued
        // now — and the flush at shutdown is the one with no next chance.
        while (this.flushInFlight !== null) {
            await this.flushInFlight;
        }
        this.flushInFlight = this.writePending();
        try {
            await this.flushInFlight;
        } finally {
            this.flushInFlight = null;
        }
    }

    get pendingFrameCount(): number {
        return this.pendingFrames.length;
    }

    get pendingGapCount(): number {
        return this.pendingGaps.length;
    }

    /**
     * Whether one gap continues another rather than describing its own hole.
     *
     * @param previous - The gap already queued.
     * @param gap - The gap being queued now.
     * @returns True when they share a cause and leave no recorded time between them.
     */
    private doesCarryOn(previous: RecordingGap, gap: RecordingGap): boolean {
        return previous.gapReason === gap.gapReason
            && gap.gapStartedAtMs <= previous.gapEndedAtMs;
    }

    private async writePending(): Promise<void> {
        await this.writeFrames();
        await this.writeTradeClusters();
        await this.writeGaps();
    }

    /**
     * Writes queued gaps one at a time, keeping any that fail.
     */
    private async writeGaps(): Promise<void> {
        const gaps = this.pendingGaps.splice(0);
        const failed: RecordingGap[] = [];

        for (const gap of gaps) {
            try {
                await this.config.archive.recordGap({
                    instrumentSymbol: this.config.instrumentSymbol,
                    gap,
                });
            } catch (error) {
                failed.push(gap);
                this.config.onWriteFailed(describeError(error));
            }
        }

        this.pendingGaps.unshift(...failed);
    }

    private async writeFrames(): Promise<void> {
        const frames = this.pendingFrames.splice(0);
        if (frames.length === 0) {
            return;
        }

        try {
            await this.config.archive.appendFrames({
                instrumentSymbol: this.config.instrumentSymbol,
                priceBucketSize: this.config.priceBucketSize,
                frames,
            });
        } catch (error) {
            this.pendingFrames.unshift(...frames);
            this.config.onWriteFailed(describeError(error));
            this.dropOldestFramesOverCapacity();
        }
    }

    private async writeTradeClusters(): Promise<void> {
        const clusters = this.pendingTradeClusters.splice(0);
        if (clusters.length === 0) {
            return;
        }

        try {
            await this.config.archive.appendTradeClusters({
                instrumentSymbol: this.config.instrumentSymbol,
                priceBucketSize: this.config.priceBucketSize,
                clusters,
            });
        } catch (error) {
            this.pendingTradeClusters.unshift(...clusters);
            this.config.onWriteFailed(describeError(error));
            this.dropOldestClustersOverCapacity();
        }
    }

    private dropOldestFramesOverCapacity(): void {
        const excessCount = this.pendingFrames.length - this.config.maximumBufferedFrames;
        if (excessCount <= 0) {
            return;
        }
        const droppedFrames = this.pendingFrames.splice(0, excessCount);
        this.config.onFramesDropped(droppedFrames);
    }

    private dropOldestClustersOverCapacity(): void {
        const excessCount = this.pendingTradeClusters.length - this.config.maximumBufferedTradeClusters;
        if (excessCount > 0) {
            this.pendingTradeClusters.splice(0, excessCount);
        }
    }
}
