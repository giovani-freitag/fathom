import type {
    InstrumentCoverage,
    LiquidityFrameWindow,
    LiveTextMessage,
} from '@fathom/contracts';
import {
    type ChartViewport,
    clampViewport,
    type ViewportBounds,
} from '@core/domain/chart-viewport';
import { describeLoadFailure } from '@core/domain/failure-copy';
import { ObservableStore } from '@core/kernel/observable-store';
import type { HeatmapApiService } from '@core/services/heatmap-api/heatmap-api-service';
import type { LiveFeedService, LiveFeedStatus } from '@core/services/live-feed/live-feed-service';
import type { PreferencesService, ViewerPreferences } from '@core/services/preferences/preferences-service';
import {
    appendClusters,
    appendFrames,
    type ChartDataset,
    EMPTY_DATASET,
    newestFrameTimestamp,
    replaceDataset,
} from './chart-dataset';
import { type LoadedWindow, WindowLoader, type WindowLoadRequest } from './window-loader';

const MINIMUM_SPAN_MS = 5_000;
const MAXIMUM_SPAN_MS = 90 * 24 * 60 * 60 * 1_000;

/** Fraction of mid price shown on first load, where the working book actually is. */
const INITIAL_PRICE_RANGE_RATIO = 0.004;

export type ChartPhase = 'initialising' | 'ready' | 'empty' | 'failed';

export interface ChartState {
    readonly phase: ChartPhase;
    readonly errorMessage: string | null;
    readonly instruments: readonly InstrumentCoverage[];
    readonly instrumentSymbol: string | null;
    readonly viewport: ChartViewport;
    readonly dataset: ChartDataset;
    readonly liveStatus: LiveFeedStatus;
    readonly isFollowingLive: boolean;
    readonly isLoadingWindow: boolean;
    readonly colourGain: number;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
}

export interface ChartControllerConfig {
    readonly api: HeatmapApiService;
    readonly liveFeed: LiveFeedService;
    readonly preferences: PreferencesService;
}

export interface ViewRequest {
    readonly viewport: ChartViewport;
    readonly surfaceWidthPx: number;
    /** Pass false when the gesture moved the view off the right edge. */
    readonly isFollowingLive?: boolean;
}

export type ChartSettingsPatch = Partial<
    Pick<ChartState, 'colourGain' | 'isTradeOverlayVisible' | 'isVolumeProfileVisible'>
>;

/**
 * Everything the chart knows, and the only thing that changes it.
 *
 * Holds the viewport, the loaded window, and the live tail, and decides when a
 * gesture has moved far enough to be worth another round trip. The renderer and
 * the React tree only read from here.
 */
export class ChartController {
    readonly store: ObservableStore<ChartState>;

    private readonly config: ChartControllerConfig;
    private readonly windowLoader: WindowLoader;
    private surfaceWidthPx = 800;
    private needsPriceFraming = true;
    private wasDisposed = false;

    constructor(config: ChartControllerConfig) {
        this.config = config;
        this.handleLiveFrames = this.handleLiveFrames.bind(this);
        this.handleLiveText = this.handleLiveText.bind(this);
        this.handleLiveStatus = this.handleLiveStatus.bind(this);
        this.handleWindowLoaded = this.handleWindowLoaded.bind(this);
        this.handleLoadingChanged = this.handleLoadingChanged.bind(this);
        this.publishFailure = this.publishFailure.bind(this);

        this.windowLoader = new WindowLoader({
            api: config.api,
            onLoaded: this.handleWindowLoaded,
            onFailed: this.publishFailure,
            onLoadingChanged: this.handleLoadingChanged,
        });

        const preferences = config.preferences.read();
        this.store = new ObservableStore<ChartState>({
            initialState: buildInitialState(preferences),
        });
    }

    /**
     * Loads the instrument list and opens the first window.
     *
     * Never rejects: a failure is published as the `failed` phase, because the
     * shell has to stay on screen to explain it.
     */
    async initialize(): Promise<void> {
        try {
            const instruments = await this.config.api.fetchInstruments();
            const preferred = this.choosePreferredInstrument(instruments);

            if (preferred === null) {
                this.store.update((current) => ({ ...current, phase: 'empty', instruments }));
                return;
            }

            this.store.update((current) => ({
                ...current,
                instruments,
                instrumentSymbol: preferred.instrumentSymbol,
                viewport: buildInitialViewport(preferred, current.viewport.toMs - current.viewport.fromMs),
                phase: 'ready',
            }));
            await this.loadWindow();
            this.openLiveTail();
        } catch (error) {
            this.publishFailure(error);
        }
    }

    /**
     * Releases the live tail and cancels any pending work.
     */
    dispose(): void {
        this.wasDisposed = true;
        this.windowLoader.dispose();
        this.config.liveFeed.disconnect();
    }

    /**
     * Points the chart at another instrument.
     *
     * @param instrumentSymbol - Symbol to show; ignored when it is not recorded.
     */
    selectInstrument(instrumentSymbol: string): void {
        const current = this.store.read();
        if (current.instrumentSymbol === instrumentSymbol) {
            return;
        }
        const instrument = current.instruments.find(
            (candidate) => candidate.instrumentSymbol === instrumentSymbol,
        );
        if (instrument === undefined) {
            return;
        }

        this.windowLoader.reset();
        this.needsPriceFraming = true;
        this.store.update((state) => ({
            ...state,
            instrumentSymbol,
            dataset: EMPTY_DATASET,
            isFollowingLive: true,
            viewport: buildInitialViewport(instrument, state.viewport.toMs - state.viewport.fromMs),
        }));
        this.persistPreferences();
        void this.loadWindow().then(() => this.openLiveTail());
    }

    /**
     * Adopts a viewport produced by a gesture and schedules any refetch it needs.
     *
     * @param request - The requested viewport and the surface it was measured on.
     */
    applyView(request: ViewRequest): void {
        this.surfaceWidthPx = Math.max(1, request.surfaceWidthPx);
        const bounds = this.resolveBounds();
        const viewport = clampViewport(request.viewport, bounds);

        this.store.update((state) => ({
            ...state,
            viewport,
            isFollowingLive: request.isFollowingLive ?? state.isFollowingLive,
        }));

        const loadRequest = this.buildLoadRequest();
        if (loadRequest !== null) {
            this.windowLoader.scheduleIfStale(loadRequest);
        }
    }

    /**
     * Changes a display setting and remembers it.
     *
     * @param patch - The settings to change; anything absent is left alone.
     */
    updateSettings(patch: ChartSettingsPatch): void {
        this.store.update((state) => ({ ...state, ...patch }));
        this.persistPreferences();
    }

    private choosePreferredInstrument(
        instruments: readonly InstrumentCoverage[],
    ): InstrumentCoverage | null {
        const recorded = instruments.filter((candidate) => candidate.lastFrameAtMs !== null);
        const preferredSymbol = this.config.preferences.read().instrumentSymbol;
        return recorded.find((candidate) => candidate.instrumentSymbol === preferredSymbol)
            ?? recorded[0]
            ?? null;
    }

    private resolveBounds(): ViewportBounds {
        const state = this.store.read();
        const instrument = state.instruments.find(
            (candidate) => candidate.instrumentSymbol === state.instrumentSymbol,
        );

        return {
            earliestMs: instrument?.firstFrameAtMs ?? 0,
            // The tail may be seconds ahead of the newest frame the viewer holds,
            // so the edge follows the clock rather than the data.
            latestMs: Math.max(Date.now(), instrument?.lastFrameAtMs ?? 0),
            minimumSpanMs: MINIMUM_SPAN_MS,
            maximumSpanMs: MAXIMUM_SPAN_MS,
            minimumPriceSpan: state.dataset.priceBucketSize * 4,
        };
    }

    private resolveTradePriceGroupSize(): number {
        const state = this.store.read();
        const priceSpan = state.viewport.highPrice - state.viewport.lowPrice;
        const bucketSize = state.dataset.priceBucketSize;
        if (priceSpan <= 0 || bucketSize <= 0) {
            return 1;
        }
        // Aim for bubbles no smaller than a few pixels: below that they merge
        // into a smear and cost bandwidth for nothing.
        const visibleBuckets = priceSpan / bucketSize;
        return Math.max(1, Math.round(visibleBuckets / 220));
    }

    private buildLoadRequest(): WindowLoadRequest | null {
        const state = this.store.read();
        if (state.instrumentSymbol === null) {
            return null;
        }
        return {
            symbol: state.instrumentSymbol,
            viewport: state.viewport,
            surfaceWidthPx: this.surfaceWidthPx,
            priceGroupSize: this.resolveTradePriceGroupSize(),
        };
    }

    private async loadWindow(): Promise<void> {
        const request = this.buildLoadRequest();
        if (request === null || this.wasDisposed) {
            return;
        }
        await this.windowLoader.load(request);
    }

    private handleLoadingChanged(isLoadingWindow: boolean): void {
        this.store.update((state) => ({ ...state, isLoadingWindow }));
    }

    private handleWindowLoaded(loaded: LoadedWindow): void {
        const symbol = this.store.read().instrumentSymbol;
        if (symbol === null || this.wasDisposed) {
            return;
        }

        this.store.update((current) => {
            const dataset = replaceDataset({
                instrumentSymbol: symbol,
                window: loaded.window,
                clusters: loaded.clusters,
                clusterPriceBucketSize: loaded.clusterPriceBucketSize,
                clusterIntervalMs: loaded.clusterIntervalMs,
                gaps: loaded.gaps,
                previousRevision: current.dataset.revision,
            });
            return {
                ...current,
                isLoadingWindow: false,
                phase: dataset.frames.length === 0 ? 'empty' : 'ready',
                errorMessage: null,
                dataset,
                viewport: this.framePriceRange(current.viewport, dataset),
            };
        });
    }

    private openLiveTail(): void {
        const state = this.store.read();
        if (state.instrumentSymbol === null || this.wasDisposed) {
            return;
        }

        this.config.liveFeed.connect({
            instrumentSymbol: state.instrumentSymbol,
            afterMs: newestFrameTimestamp(state.dataset) ?? Date.now(),
            onFrames: this.handleLiveFrames,
            onText: this.handleLiveText,
            onStatusChanged: this.handleLiveStatus,
        });
    }

    private handleLiveFrames(window: LiquidityFrameWindow): void {
        this.store.update((state) => {
            const dataset = appendFrames(state.dataset, window.frames);
            if (dataset === state.dataset) {
                return state;
            }
            return { ...state, dataset, viewport: this.advanceViewport(state, dataset) };
        });
    }

    private handleLiveText(message: LiveTextMessage): void {
        if (message.kind !== 'trade-clusters') {
            return;
        }
        this.store.update((state) => ({
            ...state,
            dataset: appendClusters(state.dataset, message.clusters),
        }));
    }

    private handleLiveStatus(liveStatus: LiveFeedStatus): void {
        this.store.update((state) => ({ ...state, liveStatus }));
    }

    private advanceViewport(state: ChartState, dataset: ChartDataset): ChartViewport {
        const newestMs = newestFrameTimestamp(dataset);
        if (!state.isFollowingLive || newestMs === null || newestMs <= state.viewport.toMs) {
            return state.viewport;
        }
        const deltaMs = newestMs - state.viewport.toMs;
        return {
            ...state.viewport,
            fromMs: state.viewport.fromMs + deltaMs,
            toMs: newestMs,
        };
    }

    /**
     * Centres the price axis on the book the first time real depth arrives.
     *
     * The initial viewport is built before any price is known, so the price
     * range is a placeholder until a window lands. Reframing on every load
     * instead would fight the user's own zoom.
     */
    private framePriceRange(viewport: ChartViewport, dataset: ChartDataset): ChartViewport {
        const newestFrame = dataset.frames[dataset.frames.length - 1];
        if (!this.needsPriceFraming || newestFrame === undefined) {
            return viewport;
        }

        this.needsPriceFraming = false;
        const midPrice = (newestFrame.bestBidPrice + newestFrame.bestAskPrice) / 2;
        const halfRange = midPrice * INITIAL_PRICE_RANGE_RATIO;
        return { ...viewport, lowPrice: midPrice - halfRange, highPrice: midPrice + halfRange };
    }

    private get isDisposed(): boolean {
        return this.wasDisposed;
    }

    private persistPreferences(): void {
        const state = this.store.read();
        this.config.preferences.write({
            instrumentSymbol: state.instrumentSymbol ?? 'BTCUSDT',
            visibleSpanMs: state.viewport.toMs - state.viewport.fromMs,
            colourGain: state.colourGain,
            isTradeOverlayVisible: state.isTradeOverlayVisible,
            isVolumeProfileVisible: state.isVolumeProfileVisible,
        });
    }

    /**
     * Records a load failure without throwing away what is already on screen.
     *
     * Frames already loaded are real recordings, and a reader looking at a wall
     * from ten minutes ago still learns from it. Blanking the chart because the
     * next request failed destroys good information to report a transient fault
     * the status strip is already showing.
     */
    private publishFailure(error: unknown): void {
        const errorMessage = describeLoadFailure(error);
        this.store.update((state) => ({
            ...state,
            phase: state.dataset.frames.length > 0 ? state.phase : 'failed',
            isLoadingWindow: false,
            errorMessage,
        }));
    }
}

function buildInitialState(preferences: ViewerPreferences): ChartState {
    const nowMs = Date.now();
    return {
        phase: 'initialising',
        errorMessage: null,
        instruments: [],
        instrumentSymbol: null,
        viewport: {
            fromMs: nowMs - preferences.visibleSpanMs,
            toMs: nowMs,
            lowPrice: 0,
            highPrice: 1,
        },
        dataset: EMPTY_DATASET,
        liveStatus: 'idle',
        isFollowingLive: true,
        isLoadingWindow: false,
        colourGain: preferences.colourGain,
        isTradeOverlayVisible: preferences.isTradeOverlayVisible,
        isVolumeProfileVisible: preferences.isVolumeProfileVisible,
    };
}

function buildInitialViewport(instrument: InstrumentCoverage, spanMs: number): ChartViewport {
    const toMs = instrument.lastFrameAtMs ?? Date.now();
    return {
        fromMs: toMs - spanMs,
        toMs,
        // The real price is unknown until the first window lands; the first
        // render corrects it from the newest frame.
        lowPrice: 0,
        highPrice: 1,
    };
}
