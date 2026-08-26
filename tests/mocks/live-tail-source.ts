import type { BetweenRequest, FramesAfterRequest, LiveTailSource } from '../../src/shared/core/live-tail.ts';
import type { LiquidityFrame, LiquidityFrameWindow } from '../../src/shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../src/shared/core/recording-gap.ts';
import type { TradeCluster } from '../../src/shared/core/trade-cluster.ts';
import { vi } from 'vitest';

export interface LiveTailSourceMock {
    readonly source: LiveTailSource;
    readonly fetchFramesAfter: ReturnType<typeof vi.fn>;
    readonly fetchTradeClustersBetween: ReturnType<typeof vi.fn>;
    readonly fetchGapsBetween: ReturnType<typeof vi.fn>;
}

/**
 * Builds a frame on the grid a collector records on.
 *
 * @param capturedAtMs - The instant it stands for.
 * @returns One frame, with a ladder on each side.
 */
export function buildTailFrame(capturedAtMs: number): LiquidityFrame {
    return {
        capturedAtMs,
        bestBidPrice: 100,
        bestAskPrice: 101,
        bids: { lowestBucketIndex: 9, quantities: Float32Array.from([1]) },
        asks: { lowestBucketIndex: 10, quantities: Float32Array.from([2]) },
    };
}

/**
 * Wraps frames the way an archive answers a tail.
 *
 * @param frames - What the read returned.
 * @returns The window carrying them.
 */
export function buildTailWindow(frames: LiquidityFrame[]): LiquidityFrameWindow {
    return { priceBucketSize: 10, sampleIntervalMs: 1_000, frames };
}

/**
 * Every read a tail makes as a spy, so a test can steer the answers and assert
 * the cursor it asked with.
 *
 * @returns The source and its three spies.
 */
export function createLiveTailSourceMock(): LiveTailSourceMock {
    const fetchFramesAfter = vi.fn<(request: FramesAfterRequest) => Promise<LiquidityFrameWindow>>()
        .mockResolvedValue(buildTailWindow([]));
    const fetchTradeClustersBetween = vi.fn<(request: BetweenRequest) => Promise<readonly TradeCluster[]>>()
        .mockResolvedValue([]);
    const fetchGapsBetween = vi.fn<(request: BetweenRequest) => Promise<readonly RecordingGap[]>>()
        .mockResolvedValue([]);

    return {
        source: { fetchFramesAfter, fetchTradeClustersBetween, fetchGapsBetween },
        fetchFramesAfter,
        fetchTradeClustersBetween,
        fetchGapsBetween,
    };
}
