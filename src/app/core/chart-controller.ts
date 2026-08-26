import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import type { DrawPlan } from '../../shared/core/draw-plan.ts';
import type { LiveMessage } from '../../shared/core/live-message.ts';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';
import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import {
    type ChartViewport,
    clampViewport,
    type ViewportBounds,
} from './chart-viewport.ts';
import { resolveFailureKey } from './failure-copy.ts';
import { ObservableStore } from './observable-store.ts';
import type { HeatmapSource } from '../../shared/core/heatmap-source.ts';
import type { LiveFeed, LiveFeedStatus } from '../services/live-feed.ts';
import type { PreferencesService, ViewerPreferences } from '../services/preferences-service.ts';
import {
    appendClusters,
    appendFrames,
    appendGap,
    type ChartDataset,
    EMPTY_DATASET,
    newestFrameTimestamp,
    recutDataset,
    replaceDataset,
} from './chart-dataset.ts';
import {
    followLiveEdge,
    followTouchPrice,
    frameOnBook,
    resolveTradePriceGroupSize,
    resolveViewportBounds,
} from './viewport-policy.ts';
import { type LoadedWindow, WindowLoader, type WindowLoadRequest } from './window-loader.ts';
import {
    findIndicator,
    resolveRequiredWarmupBars,
} from '../indicators/indicator-catalogue.ts';
import { resolveFieldSettings } from '../indicators/field-layers.ts';
import { type AddedIndicator, resolveBandKey } from '../../shared/core/indicator-selection.ts';
import { isPlanWithinBudget, recolourPlan } from '../../shared/core/draw-plan.ts';

/** How often the instrument listing and its coverage are re-read. */
const COVERAGE_REFRESH_MS = 5_000;

export type ChartPhase = 'initialising' | 'ready' | 'empty' | 'failed';

export interface ChartState {
    readonly phase: ChartPhase;
    /** Named rather than written out, so the reader's language decides the words. */
    readonly failureKey: TranslationKey | null;
    readonly instruments: readonly InstrumentCoverage[];
    readonly instrumentSymbol: string | null;
    readonly viewport: ChartViewport;
    readonly dataset: ChartDataset;
    readonly liveStatus: LiveFeedStatus;
    readonly isFollowingLive: boolean;
    readonly isFollowingPrice: boolean;
    readonly isLoadingWindow: boolean;
    readonly colourGain: number;
    /** Fraction of the window below which resting size is painted as empty. */
    readonly depthFloorPercentile: number;
    /** Fraction of the window at which resting size reaches the hot end. */
    readonly depthSaturationPercentile: number;
    /** False leaves a plain price chart, with no book behind it. */
    readonly isDepthVisible: boolean;
    readonly isCandleOverlayVisible: boolean;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
    readonly addedIndicators: readonly AddedIndicator[];
    /** What the indicators produced for the window on screen. */
    readonly plans: readonly DrawPlan[];
}

export interface ChartControllerConfig {
    readonly api: HeatmapSource;
    readonly liveFeed: LiveFeed;
    readonly preferences: PreferencesService;
}

export interface ViewRequest {
    readonly viewport: ChartViewport;
    readonly surfaceWidthPx: number;
    /** Pass false when the gesture moved the view off the right edge. */
    readonly isFollowingLive?: boolean;
    /** Pass false when the gesture chose a price band of its own. */
    readonly isFollowingPrice?: boolean;
}

/**
 * Everything the chart knows, and the only thing that changes it.
 */
export class ChartController {
    readonly store: ObservableStore<ChartState>;

    private readonly config: ChartControllerConfig;
    private readonly windowLoader: WindowLoader;
    private surfaceWidthPx = 800;
    private needsPriceFraming = true;
    private wasDisposed = false;
    private coverageTimer: ReturnType<typeof setInterval> | null = null;

    constructor(config: ChartControllerConfig) {
        this.config = config;
        this.handleLiveMessage = this.handleLiveMessage.bind(this);
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
     */
    /**
     * Re-reads which contracts exist, without disturbing what is on screen.
     *
     * @throws nothing: a listing that will not answer leaves the current one.
     */
    async refreshInstruments(): Promise<void> {
        try {
            const instruments = await this.config.api.fetchInstruments();
            this.store.update((current) => ({ ...current, instruments }));
        } catch {
            // The chart still has the contracts it knew about; a failed refresh
            // is not worth replacing a working screen with an error.
        }
    }

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
            this.watchCoverage();
        } catch (error) {
            this.publishFailure(error);
        }
    }

    /**
     * Keeps the listing and the coverage it carries current.
     *
     * @param intervalMs - How often to re-read.
     */
    private watchCoverage(intervalMs = COVERAGE_REFRESH_MS): void {
        if (this.coverageTimer !== null) {
            return;
        }
        // Read once at startup, the listing freezes: a contract switched on
        // never appears in the picker, and "recorded so far" keeps reporting
        // the span the page happened to open with.
        this.coverageTimer = setInterval(() => { void this.refreshInstruments(); }, intervalMs);
    }

    /**
     * Releases the live tail and cancels any pending work.
     */
    dispose(): void {
        this.wasDisposed = true;
        if (this.coverageTimer !== null) {
            clearInterval(this.coverageTimer);
            this.coverageTimer = null;
        }
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
            isFollowingPrice: request.isFollowingPrice ?? state.isFollowingPrice,
        }));

        const loadRequest = this.buildLoadRequest();
        if (loadRequest !== null) {
            this.windowLoader.scheduleIfStale(loadRequest);
        }
    }

    /**
     * Runs the indicators over the window on screen.
     *
     * Inline and synchronous because these are ours: moving a first-party
     * indicator to a worker costs more in copying the bars across than the
     * arithmetic it was meant to move off the thread.
     */
    private computePlans(state: ChartState): readonly DrawPlan[] {
        const plans: DrawPlan[] = [];
        for (const entry of state.addedIndicators) {
            const indicator = findIndicator(entry.indicatorId);
            // A hidden indicator produces nothing, so it takes no band and costs
            // no arithmetic. What it keeps is how it was tuned.
            if (indicator === null || entry.isHidden === true) {
                continue;
            }
            const plan = indicator.compute({
                bars: state.dataset.bars,
                warmupBarCount: state.dataset.bars.warmupBarsReturned,
                settings: entry.settings,
            });
            // Rejected whole rather than clipped. A plan over budget is a bug in
            // whoever produced it, and drawing part of one shows the reader a
            // claim its author never made.
            if (isPlanWithinBudget(plan)) {
                plans.push({
                    ...recolourPlan(plan, entry.tone),
                    instanceId: entry.instanceId,
                    bandKey: resolveBandKey(entry),
                    tuning: describeTuning(entry),
                });
            }
        }
        return plans;
    }

    /**
     * Revises the set of indicators on the chart.
     *
     * Takes a revision rather than a replacement because the caller's idea of
     * the current set is one render old: two additions in the same frame would
     * each append to the same stale list, and the second would land on top of
     * the first instead of after it.
     *
     * @param revise - Given the set in force, returns the set to put in its place.
     */
    updateIndicators(
        revise: (current: readonly AddedIndicator[]) => readonly AddedIndicator[],
    ): void {
        const before = resolveRequiredWarmupBars(this.store.read().addedIndicators);
        this.store.update((state) => {
            const addedIndicators = revise(state.addedIndicators);
            const next = { ...state, addedIndicators, ...resolveFieldSettings(addedIndicators) };
            // The cuts decide what the depth map is built from, so moving one is
            // a reason to rebuild it rather than only to repaint.
            const recutState = hasMovedACut(state, next) ? { ...next, dataset: recut(next) } : next;
            return { ...recutState, plans: this.computePlans(recutState) };
        });
        this.persistPreferences();

        // A deeper indicator needs history the loaded window does not hold, and
        // seeding from what is there would draw a converged-looking line that is
        // not one.
        if (resolveRequiredWarmupBars(this.store.read().addedIndicators) > before) {
            void this.loadWindow();
        }
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
        return resolveViewportBounds({
            instrument: state.instruments.find(
                (candidate) => candidate.instrumentSymbol === state.instrumentSymbol,
            ),
            priceBucketSize: state.dataset.priceBucketSize,
            nowMs: Date.now(),
        });
    }

    private buildLoadRequest(): WindowLoadRequest | null {
        const state = this.store.read();
        if (state.instrumentSymbol === null) {
            return null;
        }
        const instrument = state.instruments.find(
            (candidate) => candidate.instrumentSymbol === state.instrumentSymbol,
        );

        return {
            symbol: state.instrumentSymbol,
            viewport: state.viewport,
            surfaceWidthPx: this.surfaceWidthPx,
            frameIntervalMs: instrument?.frameIntervalMs ?? state.dataset.sampleIntervalMs,
            priceGroupSize: resolveTradePriceGroupSize(state.viewport, state.dataset.priceBucketSize),
            warmupBars: resolveRequiredWarmupBars(state.addedIndicators),
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
                bars: loaded.bars,
                previousRevision: current.dataset.revision,
                previousSaturationQuantity: current.dataset.saturationQuantity,
                previousFloorQuantity: current.dataset.floorQuantity,
                floorPercentile: current.depthFloorPercentile,
                saturationPercentile: current.depthSaturationPercentile,
            });
            const next = {
                ...current,
                isLoadingWindow: false,
                phase: (dataset.frames.length === 0 ? 'empty' : 'ready') as ChartPhase,
                failureKey: null,
                dataset,
                viewport: this.framePriceRange(current.viewport, dataset),
            };
            return { ...next, plans: this.computePlans(next) };
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
            onMessage: this.handleLiveMessage,
            onStatusChanged: this.handleLiveStatus,
        });
    }

    private handleLiveFrames(window: LiquidityFrameWindow): void {
        this.store.update((state) => {
            const dataset = appendFrames(state.dataset, window.frames);
            if (dataset === state.dataset) {
                return state;
            }
            const next = { ...state, dataset, viewport: this.advanceViewport(state, dataset) };
            return { ...next, plans: this.computePlans(next) };
        });
    }

    /**
     * Takes one message from whichever tail is feeding this chart.
     */
    private handleLiveMessage(message: LiveMessage): void {
        if (message.kind === 'frames') {
            this.handleLiveFrames(message.window);
            return;
        }
        if (message.kind === 'trade-clusters') {
            this.store.update((state) => ({
                ...state,
                dataset: appendClusters(state.dataset, message.clusters),
            }));
            return;
        }
        if (message.kind === 'gap') {
            // A stretch that went unrecorded while the reader was watching. It
            // used to reach the chart only on a reload, which showed the window
            // as continuous until then.
            this.store.update((state) => ({
                ...state,
                dataset: appendGap(state.dataset, message.gap),
            }));
        }
    }

    private handleLiveStatus(liveStatus: LiveFeedStatus): void {
        this.store.update((state) => ({ ...state, liveStatus }));
    }

    /**
     * Moves the viewport for a newly streamed frame.
     */
    private advanceViewport(state: ChartState, dataset: ChartDataset): ChartViewport {
        if (!state.isFollowingLive) {
            return state.viewport;
        }

        const onLiveEdge = followLiveEdge(state.viewport, dataset);
        return state.isFollowingPrice ? followTouchPrice(onLiveEdge, dataset) : onLiveEdge;
    }

    /**
     * Frames the price axis on what is being drawn, once per instrument.
     */
    private framePriceRange(viewport: ChartViewport, dataset: ChartDataset): ChartViewport {
        if (!this.needsPriceFraming || dataset.frames.length === 0) {
            return viewport;
        }
        this.needsPriceFraming = false;
        return frameOnBook(viewport, dataset, this.store.read().isDepthVisible);
    }

    private get isDisposed(): boolean {
        return this.wasDisposed;
    }

    private persistPreferences(): void {
        const state = this.store.read();
        this.config.preferences.write({
            instrumentSymbol: state.instrumentSymbol ?? 'BTCUSDT',
            visibleSpanMs: state.viewport.toMs - state.viewport.fromMs,
            addedIndicators: state.addedIndicators,
        });
    }

    /**
     * Records a load failure without throwing away what is already on screen.
     */
    private publishFailure(error: unknown): void {
        const failureKey = resolveFailureKey(error);
        this.store.update((state) => ({
            ...state,
            phase: state.dataset.frames.length > 0 ? state.phase : 'failed',
            isLoadingWindow: false,
            failureKey,
        }));
    }
}

/**
 * What an added indicator was run with, as one line.
 *
 * Everything the drawing depends on and the plan does not otherwise carry: the
 * colour it was recoloured to, and every setting, including the ones that leave
 * no mark on the summary a reader sees.
 */
function describeTuning(entry: AddedIndicator): string {
    const settings = Object.entries(entry.settings)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',');
    return `${entry.tone}|${settings}`;
}

function buildInitialState(preferences: ViewerPreferences): ChartState {
    const nowMs = Date.now();
    return {
        phase: 'initialising',
        failureKey: null,
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
        isFollowingPrice: true,
        isLoadingWindow: false,
        ...resolveFieldSettings(preferences.addedIndicators),
        addedIndicators: preferences.addedIndicators,
        plans: [],
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

function hasMovedACut(before: ChartState, after: ChartState): boolean {
    return before.depthFloorPercentile !== after.depthFloorPercentile
        || before.depthSaturationPercentile !== after.depthSaturationPercentile;
}

function recut(state: ChartState): ChartDataset {
    return recutDataset(
        state.dataset,
        state.depthFloorPercentile,
        state.depthSaturationPercentile,
    );
}
