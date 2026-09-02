import { EMPTY_BAR_WINDOW } from '../../src/shared/core/price-bar.ts';
import type { PriceBarWindow } from '../../src/shared/core/price-bar.ts';
import type { InstrumentCoverage } from '../../src/shared/core/api-contract.ts';
import type { LiquidityFrame, LiquidityFrameWindow } from '../../src/shared/core/liquidity-frame.ts';
import type { HeatmapSource } from '../../src/shared/core/heatmap-source.ts';
import type { LiveFeedService, LiveFeedSubscription } from '../../src/app/services/live-feed-service.ts';
import type { PreferencesService, ViewerPreferences } from '../../src/app/services/preferences-service.ts';
import { DEFAULT_PREFERENCES } from '../../src/app/services/preferences-service.ts';
import { vi } from 'vitest';

export const INSTRUMENT: InstrumentCoverage = {
    instrumentSymbol: 'BTCUSDT',
    priceBucketSize: 10,
    frameIntervalMs: 1_000,
    firstFrameAtMs: 1_000_000,
    lastFrameAtMs: 2_000_000,
    lastMidPrice: 79_000,
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

/** How bars on a rung are asked for, as the spy sees it. */
type PriceBarRead = (
    query: { symbol: string; fromMs: number; toMs: number; intervalMs: number; warmupBars: number },
    signal?: AbortSignal,
) => Promise<PriceBarWindow>;

/** How a window of instants is asked for, as the spy sees it. */
type FrameWindowRead = (
    query: {
        fromMs: number;
        toMs: number;
        maxColumns: number;
        priceBand?: { lowPrice: number; highPrice: number; maxRows: number } | undefined;
    },
    signal?: AbortSignal,
) => Promise<LiquidityFrameWindow>;

export interface ChartServiceMocks {
    readonly api: HeatmapSource;
    readonly liveFeed: LiveFeedService;
    readonly preferences: PreferencesService;
    readonly fetchInstruments: ReturnType<typeof vi.fn>;
    /**
     * Typed, unlike its neighbours, because tests steer it by what was asked.
     *
     * A reader panning asks only for the stretch it does not already hold, so a
     * test of that has to answer differently for different stretches — and an
     * implementation handed to an untyped spy has no return type to check.
     */
    readonly fetchFrameWindow: ReturnType<typeof vi.fn<FrameWindowRead>>;
    readonly fetchTradeClusters: ReturnType<typeof vi.fn>;
    readonly fetchGaps: ReturnType<typeof vi.fn>;
    readonly fetchPriceBars: ReturnType<typeof vi.fn<PriceBarRead>>;
    readonly connect: ReturnType<typeof vi.fn>;
    readonly disconnect: ReturnType<typeof vi.fn>;
    readonly writePreferences: ReturnType<typeof vi.fn>;
    /** The subscription the controller opened, so a test can push live frames. */
    lastSubscription: () => LiveFeedSubscription | undefined;
    /** Hands the chart a window the way a tail would. */
    deliverFrames: (window: LiquidityFrameWindow) => void;
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
    const fetchFrameWindow = vi.fn<FrameWindowRead>()
        .mockResolvedValue(buildWindow([buildFrame(1_500_000)]));
    const fetchTradeClusters = vi.fn().mockResolvedValue({
        priceBucketSize: 10,
        sampleIntervalMs: 5_000,
        clusters: [],
    });
    const fetchGaps = vi.fn().mockResolvedValue([]);
    const fetchPriceBars = vi.fn<PriceBarRead>().mockResolvedValue(EMPTY_BAR_WINDOW);
    const connect = vi.fn();
    const disconnect = vi.fn();
    const writePreferences = vi.fn();

    return {
        api: {
            fetchInstruments, fetchFrameWindow, fetchTradeClusters, fetchGaps, fetchPriceBars,
            // Cast to the whole surface the chart reads: the archive answers
            // four of the five questions and the venue answers the bars, and a
            // test drives the pair the way the application wires them.
        },
        liveFeed: { connect, disconnect } as unknown as LiveFeedService,
        preferences: {
            read: () => ({ ...DEFAULT_PREFERENCES, ...preferences }),
            write: writePreferences,
        } as unknown as PreferencesService,
        fetchInstruments,
        fetchFrameWindow,
        fetchTradeClusters,
        fetchGaps,
        fetchPriceBars,
        connect,
        disconnect,
        writePreferences,
        lastSubscription: () => connect.mock.calls.at(-1)?.[0] as LiveFeedSubscription | undefined,
        deliverFrames: (window: LiquidityFrameWindow) => {
            const subscription = connect.mock.calls.at(-1)?.[0] as LiveFeedSubscription | undefined;
            subscription?.onMessage({ kind: 'frames', window });
        },
    };
}
