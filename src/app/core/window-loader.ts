import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';
import type { ChartViewport } from './chart-viewport.ts';
import type { HeatmapSource } from '../../shared/core/heatmap-source.ts';

/** Loaded window is this much wider than the view, so a short pan needs no refetch. */
const OVERSCAN_RATIO = 0.6;

/** Gesture settling time before a refetch; a pinch fires dozens of viewport writes. */
const RELOAD_DEBOUNCE_MS = 220;

/** Executions binned finer than this per column are indistinguishable on screen. */
const TARGET_TRADE_COLUMNS = 420;

const MAXIMUM_COLUMNS = 4_000;
const MINIMUM_COLUMNS = 120;

export interface LoadedWindow {
    readonly window: LiquidityFrameWindow;
    readonly clusters: readonly TradeCluster[];
    readonly clusterPriceBucketSize: number;
    readonly clusterIntervalMs: number;
    readonly gaps: readonly RecordingGap[];
}

export interface WindowLoadRequest {
    readonly symbol: string;
    readonly viewport: ChartViewport;
    readonly surfaceWidthPx: number;
    /** Stored price buckets per returned execution bucket. */
    readonly priceGroupSize: number;
}

export interface WindowLoaderConfig {
    readonly api: HeatmapSource;
    readonly onLoaded: (loaded: LoadedWindow) => void;
    readonly onFailed: (error: unknown) => void;
    readonly onLoadingChanged: (isLoading: boolean) => void;
}

/**
 * Decides when the chart needs another round trip, and makes it.
 *
 * Owns the whole question of what is loaded: the range, the resolution, the
 * request in flight, and the one most recently asked for. Keeping that in one
 * object is what lets "do we already have this?" be answered by looking at a
 * single place rather than by reasoning across a controller.
 */
export class WindowLoader {
    private readonly config: WindowLoaderConfig;

    private loadedFromMs = 0;
    private loadedToMs = 0;
    private loadedSampleIntervalMs = Number.POSITIVE_INFINITY;
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
     * Never rejects: a failure is reported through the configured callback.
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
        return isOutsideLoaded || isTooCoarse;
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
        const overscanMs = spanMs * OVERSCAN_RATIO;
        const fromMs = request.viewport.fromMs - overscanMs;
        const toMs = request.viewport.toMs + overscanMs;
        const maxColumns = Math.min(
            MAXIMUM_COLUMNS,
            Math.max(MINIMUM_COLUMNS, Math.round(request.surfaceWidthPx * (1 + 2 * OVERSCAN_RATIO))),
        );

        return {
            fromMs,
            toMs,
            maxColumns,
            key: `${request.symbol}|${Math.floor(fromMs)}|${Math.ceil(toMs)}|${maxColumns}`,
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

        const [window, tradeResult, gaps] = await Promise.all([
            this.config.api.fetchFrameWindow(query, signal),
            this.config.api.fetchTradeClusters(
                {
                    ...query,
                    maxColumns: TARGET_TRADE_COLUMNS,
                    priceGroupSize: request.priceGroupSize,
                    minimumQuantity: 0,
                },
                signal,
            ),
            this.config.api.fetchGaps(query, signal),
        ]);

        return {
            window,
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
    readonly key: string;
}
