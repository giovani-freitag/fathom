import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';
import { MAXIMUM_WINDOW_MS } from '../../shared/core/api-contract.ts';
import { type BarIntervalMs, resolveBarIntervalMs, TARGET_BAR_COUNT } from './bar-interval.ts';
import type { ChartViewport } from './chart-viewport.ts';
import type { PriceBarWindow } from '../../shared/core/price-bar.ts';
import type { HeatmapSource, TradeClusterResult } from '../../shared/core/heatmap-source.ts';

/** Loaded window is this much wider than the view, so a short pan needs no refetch. */
const OVERSCAN_RATIO = 0.6;

/** Gesture settling time before a refetch; a pinch fires dozens of viewport writes. */
const RELOAD_DEBOUNCE_MS = 220;

/** Executions binned finer than this per column are indistinguishable on screen. */
const TARGET_TRADE_COLUMNS = 420;

const MAXIMUM_COLUMNS = 4_000;
const MINIMUM_COLUMNS = 120;

/** Bars a window shows. */

export interface LoadedWindow {
    readonly window: LiquidityFrameWindow;
    readonly bars: PriceBarWindow;
    readonly clusters: readonly TradeCluster[];
    readonly clusterPriceBucketSize: number;
    readonly clusterIntervalMs: number;
    readonly gaps: readonly RecordingGap[];
}

export interface WindowLoadRequest {
    readonly symbol: string;
    /** The grid the instrument records on; no bar may be finer. */
    readonly frameIntervalMs: number;
    readonly viewport: ChartViewport;
    readonly surfaceWidthPx: number;
    /** Stored price buckets per returned execution bucket. */
    readonly priceGroupSize: number;
    /** Bars to read before the window, for whatever indicator needs the most. */
    readonly warmupBars: number;
    /** The rung the reader named, or null to let the window decide. */
    readonly barIntervalMs: BarIntervalMs | null;
    /**
     * What something on the chart is going to read.
     *
     * Declared by the caller rather than assumed, so a chart drawing none of
     * the book does not fetch it.
     */
    readonly sources: readonly WindowSource[];
}

/** The bodies of data a window may hold. */
export type WindowSource = 'frames' | 'trades';

const EMPTY_FRAME_WINDOW: LiquidityFrameWindow = {
    priceBucketSize: 1,
    sampleIntervalMs: 1,
    frames: [],
};

const EMPTY_TRADE_RESULT: TradeClusterResult = {
    clusters: [],
    priceBucketSize: 1,
    sampleIntervalMs: 1,
};

export interface WindowLoaderConfig {
    readonly api: HeatmapSource;
    readonly onLoaded: (loaded: LoadedWindow) => void;
    readonly onFailed: (error: unknown) => void;
    readonly onLoadingChanged: (isLoading: boolean) => void;
}

/**
 * Decides when the chart needs another round trip, and makes it.
 */
export class WindowLoader {
    private readonly config: WindowLoaderConfig;

    private loadedFromMs = 0;
    private loadedToMs = 0;
    private loadedSampleIntervalMs = Number.POSITIVE_INFINITY;
    private loadedWarmupBars = 0;
    private lastRequestedKey = '';
    private reloadTimer: ReturnType<typeof setTimeout> | null = null;
    private inFlight: AbortController | null = null;
    private pendingRequest: WindowLoadRequest | null = null;
    private wasDisposed = false;

    constructor(config: WindowLoaderConfig) {
        this.config = config;
        this.handleReloadDue = this.handleReloadDue.bind(this);
    }

    /**
     * Fetches a window now, unless the identical one was already requested.
     *
     * @param request - Instrument, viewport, surface width, and price binning.
     */
    async load(request: WindowLoadRequest): Promise<void> {
        // Read through the accessor: narrowing the field here would convince the
        // compiler that the re-check after the await is dead, when that check is
        // exactly what stops a disposed loader from publishing a stale window.
        if (this.isDisposed) {
            return;
        }

        const range = this.resolveRange(request);
        // Decided before touching the in-flight request: aborting first and
        // returning here would cancel the very load this call defers to, and the
        // chart would open with no data at all.
        if (range.key === this.lastRequestedKey) {
            return;
        }
        this.lastRequestedKey = range.key;

        this.inFlight?.abort();
        const abortController = new AbortController();
        this.inFlight = abortController;
        this.config.onLoadingChanged(true);

        try {
            const loaded = await this.fetchAll(request, range, abortController.signal);
            if (this.wasDisposed || abortController.signal.aborted) {
                return;
            }
            this.loadedFromMs = range.fromMs;
            this.loadedToMs = range.toMs;
            this.loadedSampleIntervalMs = loaded.window.sampleIntervalMs;
            this.loadedWarmupBars = request.warmupBars;
            this.config.onLoaded(loaded);
        } catch (error) {
            this.lastRequestedKey = '';
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            this.config.onFailed(error);
        }
    }

    /**
     * Queues a fetch when the view has outgrown what is loaded.
     *
     * @param request - Instrument, viewport, surface width, and price binning.
     */
    scheduleIfStale(request: WindowLoadRequest): void {
        if (this.isDisposed || !this.isStale(request)) {
            return;
        }

        this.pendingRequest = request;
        if (this.reloadTimer !== null) {
            clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(this.handleReloadDue, RELOAD_DEBOUNCE_MS);
    }

    /**
     * Forgets what is loaded, so the next request always fetches.
     */
    reset(): void {
        this.loadedFromMs = 0;
        this.loadedToMs = 0;
        this.loadedSampleIntervalMs = Number.POSITIVE_INFINITY;
        this.loadedWarmupBars = 0;
        this.lastRequestedKey = '';
    }

    /**
     * Cancels anything pending or in flight and refuses further work.
     */
    dispose(): void {
        this.wasDisposed = true;
        if (this.reloadTimer !== null) {
            clearTimeout(this.reloadTimer);
            this.reloadTimer = null;
        }
        this.inFlight?.abort();
        this.inFlight = null;
        this.pendingRequest = null;
    }

    private get isDisposed(): boolean {
        return this.wasDisposed;
    }

    private isStale(request: WindowLoadRequest): boolean {
        const { viewport, surfaceWidthPx } = request;
        const requiredSampleMs = (viewport.toMs - viewport.fromMs) / Math.max(1, surfaceWidthPx);
        const isOutsideLoaded = viewport.fromMs < this.loadedFromMs || viewport.toMs > this.loadedToMs;

        // Half is the point where one stored column already covers two pixels;
        // refetching before that trades a round trip for detail nobody can see.
        const isTooCoarse = requiredSampleMs < this.loadedSampleIntervalMs / 2;

        // An indicator added after the fetch may reach further back than the
        // window holds. Seeding it from what is there draws a line that looks
        // converged and is not.
        const isShallow = request.warmupBars > this.loadedWarmupBars;
        return isOutsideLoaded || isTooCoarse || isShallow;
    }

    private handleReloadDue(): void {
        this.reloadTimer = null;
        const request = this.pendingRequest;
        this.pendingRequest = null;
        if (request !== null) {
            void this.load(request);
        }
    }

    private resolveRange(request: WindowLoadRequest): ResolvedRange {
        const spanMs = request.viewport.toMs - request.viewport.fromMs;
        // Held to what the archive will answer for. Asking past it earns a
        // refusal rather than an answer, and a chart that asked would go blank
        // exactly when somebody had recorded enough history to zoom out that
        // far.
        const room = Math.max(0, (MAXIMUM_WINDOW_MS - spanMs) / 2);
        const overscanMs = Math.min(spanMs * OVERSCAN_RATIO, room);
        const fromMs = request.viewport.fromMs - overscanMs;
        const toMs = request.viewport.toMs + overscanMs;
        const maxColumns = Math.min(
            MAXIMUM_COLUMNS,
            Math.max(MINIMUM_COLUMNS, Math.round(request.surfaceWidthPx * (1 + 2 * OVERSCAN_RATIO))),
        );

        // Chosen from the span alone. The depth field's resolution follows the
        // surface, and bars must not: the same window on a phone and a desktop
        // has to answer with the same bars.
        const barIntervalMs = resolveBarIntervalMs(request.barIntervalMs, {
            viewportSpanMs: spanMs,
            targetBarCount: TARGET_BAR_COUNT,
            frameIntervalMs: request.frameIntervalMs,
        });

        return {
            fromMs,
            toMs,
            maxColumns,
            barIntervalMs,
            // The warm-up belongs in the key as much as the range does: asking
            // for the same window with more history behind it is a different
            // request, and without it the fetch an added indicator triggers is
            // deduplicated away against the one that did not have it.
            key: [
                request.symbol,
                Math.floor(fromMs),
                Math.ceil(toMs),
                maxColumns,
                barIntervalMs,
                request.warmupBars,
                // Turning the book on has to fetch what it draws, and the range
                // it is drawn over has not moved.
                [...request.sources].sort().join(','),
            ].join('|'),
        };
    }

    private async fetchAll(
        request: WindowLoadRequest,
        range: ResolvedRange,
        signal: AbortSignal,
    ): Promise<LoadedWindow> {
        const query = {
            symbol: request.symbol,
            fromMs: range.fromMs,
            toMs: range.toMs,
            maxColumns: range.maxColumns,
        };

        // Only what something on the chart is going to read. The frame window
        // is by far the heaviest thing the gateway serves, and a chart showing
        // candles alone was paying for it on every fetch to draw nothing.
        const wanted = new Set(request.sources);
        const [window, tradeResult, gaps, bars] = await Promise.all([
            wanted.has('frames')
                ? this.config.api.fetchFrameWindow(query, signal)
                : Promise.resolve(EMPTY_FRAME_WINDOW),
            wanted.has('trades')
                ? this.config.api.fetchTradeClusters(
                    {
                        ...query,
                        maxColumns: TARGET_TRADE_COLUMNS,
                        priceGroupSize: request.priceGroupSize,
                        minimumQuantity: 0,
                    },
                    signal,
                )
                : Promise.resolve(EMPTY_TRADE_RESULT),
            this.config.api.fetchGaps(query, signal),
            this.config.api.fetchPriceBars({
                symbol: request.symbol,
                fromMs: range.fromMs,
                toMs: range.toMs,
                intervalMs: range.barIntervalMs,
                warmupBars: request.warmupBars,
            }, signal),
        ]);

        return {
            window,
            bars,
            clusters: tradeResult.clusters,
            clusterPriceBucketSize: tradeResult.priceBucketSize,
            clusterIntervalMs: tradeResult.sampleIntervalMs,
            gaps,
        };
    }
}

interface ResolvedRange {
    readonly fromMs: number;
    readonly toMs: number;
    readonly maxColumns: number;
    readonly barIntervalMs: number;
    readonly key: string;
}
