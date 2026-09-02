import type { LiquidityFrameWindow } from './liquidity-frame.ts';
import type { LiveMessage } from './live-message.ts';
import type { RecordingGap } from './recording-gap.ts';
import type { TradeCluster } from './trade-cluster.ts';

export interface FramesAfterRequest {
    readonly symbol: string;
    /** Newest instant already delivered; the read resumes strictly after it. */
    readonly afterMs: number;
    readonly maxFrames: number;
    /**
     * The prices on screen, so a tail carries only those.
     *
     * A whole-book store holds some fifteen thousand prices and a chart draws
     * some sixty of them. Measured on the live gateway, the tail was sending
     * sixty-two kilobytes a second for a picture that had room for a four
     * hundredth of it, and the reader's own drawing thread threw the rest away.
     */
    readonly lowPrice?: number;
    readonly highPrice?: number;
    /**
     * What one instant of the recording covers.
     *
     * A tail asks a store for a stretch and a count. Read as a budget of drawn
     * columns — which is what a window read means by it — a store folds the
     * stretch to fit, and a reader twenty minutes behind is handed one instant
     * in twelve. It moves its cursor past the rest, so what was folded away is
     * never offered again: the chart draws a column every twelfth second and
     * black between them, for ever.
     */
    readonly frameIntervalMs?: number;
}

export interface BetweenRequest {
    readonly symbol: string;
    readonly fromMs: number;
    readonly toMs: number;
}

/**
 * The reads a tail makes, narrow enough for any archive to answer.
 */
/** The half of a tail that no store keeps a copy of. */
export interface TailCompanions {
    fetchTradeClustersBetween(request: BetweenRequest): Promise<readonly TradeCluster[]>;
    fetchGapsBetween(request: BetweenRequest): Promise<readonly RecordingGap[]>;
}

export interface LiveTailSource {
    fetchFramesAfter(request: FramesAfterRequest): Promise<LiquidityFrameWindow>;
    fetchTradeClustersBetween(request: BetweenRequest): Promise<readonly TradeCluster[]>;
    fetchGapsBetween(request: BetweenRequest): Promise<readonly RecordingGap[]>;
}

export interface LiveTailConfig {
    readonly source: LiveTailSource;
    readonly instrumentSymbol: string;
    /** Newest instant the reader already holds. */
    readonly afterMs: number;
    readonly maxFramesPerPoll: number;
    readonly deliver: (message: LiveMessage) => void;
    /** The prices the reader is drawing, or absent for all of them. */
    readonly lowPrice?: number;
    readonly highPrice?: number;
    /** What one instant of the recording covers, so no read is folded. */
    readonly frameIntervalMs?: number;
}

/**
 * One reader's place in a recording, and how it catches up.
 *
 * Deliberately without a clock. Whoever owns a tail decides when it advances —
 * a timer, a notification from the database, a message from a worker — and the
 * tail only ever answers "what is there that this reader has not seen". That is
 * what lets a missed trigger cost latency and never data.
 */
export class LiveTail {
    private readonly config: LiveTailConfig;
    private frameCursorMs: number;
    private tradeCursorMs: number;
    private gapCursorMs: number;
    private isAdvancing = false;
    private wasStopped = false;

    constructor(config: LiveTailConfig) {
        this.config = config;
        this.frameCursorMs = config.afterMs;
        this.tradeCursorMs = config.afterMs;
        this.gapCursorMs = config.afterMs;
    }

    /**
     * Announces what this tail is following.
     *
     * @param priceBucketSize - The grid the instrument is recorded on.
     */
    announce(priceBucketSize: number): void {
        this.config.deliver({
            kind: 'subscribed',
            instrumentSymbol: this.config.instrumentSymbol,
            priceBucketSize,
        });
    }

    /**
     * Delivers everything recorded since the last pass.
     *
     * @returns Once the pass has finished, or immediately when one is running.
     */
    async advance(): Promise<void> {
        if (this.isAdvancing || this.wasStopped) {
            return;
        }
        this.isAdvancing = true;

        try {
            await this.deliverFrames();
            await this.deliverTradeClusters();
            await this.deliverGaps();
        } catch {
            // The cursors did not move, so the next pass reads the same range.
            // Closing a reader's tail over one unavailable read would cost them
            // the stretch that arrives while they reconnect.
        } finally {
            this.isAdvancing = false;
        }
    }

    /**
     * Stops delivering. Safe to call in any state.
     */
    stop(): void {
        this.wasStopped = true;
    }

    private async deliverFrames(): Promise<void> {
        const window = await this.config.source.fetchFramesAfter({
            symbol: this.config.instrumentSymbol,
            afterMs: this.frameCursorMs,
            maxFrames: this.config.maxFramesPerPoll,
            // Prices only, never a row budget. Folded to a budget the tail would
            // answer on a grid of its own, and a grid the window it extends does
            // not divide into cannot be laid on it at all: the frames are
            // dropped on arrival and the chart stops at the live edge.
            ...(this.config.lowPrice === undefined ? {} : { lowPrice: this.config.lowPrice }),
            ...(this.config.highPrice === undefined ? {} : { highPrice: this.config.highPrice }),
            ...(this.config.frameIntervalMs === undefined
                ? {}
                : { frameIntervalMs: this.config.frameIntervalMs }),
        });

        const newest = window.frames[window.frames.length - 1];
        if (newest === undefined || this.wasStopped) {
            return;
        }

        this.frameCursorMs = newest.capturedAtMs;
        this.config.deliver({ kind: 'frames', window });
    }

    private async deliverTradeClusters(): Promise<void> {
        if (this.frameCursorMs <= this.tradeCursorMs) {
            return;
        }

        const clusters = await this.config.source.fetchTradeClustersBetween({
            symbol: this.config.instrumentSymbol,
            fromMs: this.tradeCursorMs,
            // Inclusive of the newest frame's own instant, which is the last one
            // the reader is about to draw.
            toMs: this.frameCursorMs + 1,
        });

        this.tradeCursorMs = this.frameCursorMs;
        if (clusters.length > 0 && !this.wasStopped) {
            this.config.deliver({ kind: 'trade-clusters', clusters });
        }
    }

    private async deliverGaps(): Promise<void> {
        if (this.frameCursorMs <= this.gapCursorMs) {
            return;
        }

        const gaps = await this.config.source.fetchGapsBetween({
            symbol: this.config.instrumentSymbol,
            fromMs: this.gapCursorMs,
            toMs: this.frameCursorMs + 1,
        });

        this.gapCursorMs = this.frameCursorMs;
        if (this.wasStopped) {
            return;
        }
        for (const gap of gaps) {
            this.config.deliver({ kind: 'gap', gap });
        }
    }
}
