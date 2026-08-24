import type { LiquidityFrame, TradeCluster } from '@fathom/contracts';
import type { LiquidityArchiveService } from '@fathom/persistence';

export interface ArchiveWriteBufferConfig {
    readonly archive: LiquidityArchiveService;
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly maximumBufferedFrames: number;
    readonly maximumBufferedTradeClusters: number;
    readonly onWriteFailed: (reason: string) => void;
    readonly onFramesDropped: (droppedFrames: readonly LiquidityFrame[]) => void;
}

/**
 * Holds recorded data until the database accepts it.
 *
 * A failed batch is put back rather than discarded, because the venue will never
 * serve those seconds again. The buffer is bounded all the same: past its
 * capacity the oldest frames are dropped and reported, which is a recorded gap
 * instead of an unbounded heap.
 */
export class ArchiveWriteBuffer {
    private readonly config: ArchiveWriteBufferConfig;
    private readonly pendingFrames: LiquidityFrame[] = [];
    private readonly pendingTradeClusters: TradeCluster[] = [];
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
     * Writes everything queued, coalescing with any flush already running.
     *
     * Never rejects: a write failure is reported through the configured callback
     * and the data stays queued for the next attempt.
     */
    async flush(): Promise<void> {
        if (this.flushInFlight !== null) {
            await this.flushInFlight;
            return;
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

    private async writePending(): Promise<void> {
        await this.writeFrames();
        await this.writeTradeClusters();
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
            this.config.onWriteFailed(describe(error));
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
            this.config.onWriteFailed(describe(error));
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

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
