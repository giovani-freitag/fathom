import type { InstrumentCoverage } from '../../src/api/api-contract.ts';
import type { LiquidityFrame, LiquidityFrameWindow } from '../../src/book/liquidity-frame.ts';
import type { HeatmapApiService } from '../../src/chart/heatmap-api-service.ts';
import type { LiveFeedService, LiveFeedSubscription } from '../../src/chart/live-feed-service.ts';
import type { PreferencesService, ViewerPreferences } from '../../src/chart/preferences-service.ts';
import { DEFAULT_PREFERENCES } from '../../src/chart/preferences-service.ts';
import { vi } from 'vitest';

export const INSTRUMENT: InstrumentCoverage = {
    instrumentSymbol: 'BTCUSDT',
    priceBucketSize: 10,
    frameIntervalMs: 1_000,
    firstFrameAtMs: 1_000_000,
    lastFrameAtMs: 2_000_000,
};

export function buildFrame(capturedAtMs: number, midPrice = 79_000): LiquidityFrame {
    const touchBucket = Math.floor(midPrice / 10);
    return {
        capturedAtMs,
        bestBidPrice: midPrice - 0.5,
        bestAskPrice: midPrice + 0.5,
        bids: { lowestBucketIndex: touchBucket - 2, quantities: Float32Array.from([1, 2, 3]) },
        asks: { lowestBucketIndex: touchBucket, quantities: Float32Array.from([3, 2, 1]) },
    };
}

export function buildWindow(frames: LiquidityFrame[]): LiquidityFrameWindow {
    return { priceBucketSize: 10, sampleIntervalMs: 1_000, frames };
}

export interface ChartServiceMocks {
    readonly api: HeatmapApiService;
    readonly liveFeed: LiveFeedService;
    readonly preferences: PreferencesService;
    readonly fetchInstruments: ReturnType<typeof vi.fn>;
    readonly fetchFrameWindow: ReturnType<typeof vi.fn>;
    readonly fetchTradeClusters: ReturnType<typeof vi.fn>;
    readonly fetchGaps: ReturnType<typeof vi.fn>;
    readonly connect: ReturnType<typeof vi.fn>;
    readonly disconnect: ReturnType<typeof vi.fn>;
    readonly writePreferences: ReturnType<typeof vi.fn>;
    /** The subscription the controller opened, so a test can push live frames. */
    lastSubscription: () => LiveFeedSubscription | undefined;
}

/**
 * Every collaborator of the chart controller as a spy.
 *
 * The controller is the only place that decides what to load and when, so its
 * tests are about the calls it makes; giving each method a spy is what lets
 * those decisions be asserted rather than inferred from rendered output.
 */
export function createChartServiceMocks(
    preferences: Partial<ViewerPreferences> = {},
): ChartServiceMocks {
    const fetchInstruments = vi.fn().mockResolvedValue([INSTRUMENT]);
    const fetchFrameWindow = vi.fn().mockResolvedValue(buildWindow([buildFrame(1_500_000)]));
    const fetchTradeClusters = vi.fn().mockResolvedValue({
        priceBucketSize: 10,
        sampleIntervalMs: 5_000,
        clusters: [],
    });
    const fetchGaps = vi.fn().mockResolvedValue([]);
    const connect = vi.fn();
    const disconnect = vi.fn();
    const writePreferences = vi.fn();

    return {
        api: { fetchInstruments, fetchFrameWindow, fetchTradeClusters, fetchGaps } as unknown as HeatmapApiService,
        liveFeed: { connect, disconnect } as unknown as LiveFeedService,
        preferences: {
            read: () => ({ ...DEFAULT_PREFERENCES, ...preferences }),
            write: writePreferences,
        } as unknown as PreferencesService,
        fetchInstruments,
        fetchFrameWindow,
        fetchTradeClusters,
        fetchGaps,
        connect,
        disconnect,
        writePreferences,
        lastSubscription: () => connect.mock.calls.at(-1)?.[0] as LiveFeedSubscription | undefined,
    };
}
