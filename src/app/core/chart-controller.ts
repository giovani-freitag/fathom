import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import type { DrawPlan } from '../../shared/core/draw-plan.ts';
import type { LiveMessage } from '../../shared/core/live-message.ts';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';
import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import { foldFrameWindow } from '../../shared/core/frame-fold.ts';
import {
    type ChartViewport,
    clampViewport,
    type ViewportBounds,
} from './chart-viewport.ts';
import { INITIAL_PRICE_RANGE_RATIO } from './viewport-policy.ts';
import { resolveFailureKey } from './failure-copy.ts';
import { ObservableStore } from './observable-store.ts';
import type { HeatmapSource, PriceBandQuery } from '../../shared/core/heatmap-source.ts';
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
    followDrawnPrice,
    frameOnBook,
    resolveTradePriceGroupSize,
    resolveViewportBounds,
} from './viewport-policy.ts';
import { describeBand, DRAWN_FROM, type LoadedWindow, type WindowLoadRequest, type WindowSource, WindowLoader } from './window-loader.ts';
import {
    findIndicator,
    resolveRequiredHigherBars,
    resolveRequiredWarmupBars,
} from '../indicators/indicator-catalogue.ts';
import { type BarIntervalMs, TARGET_BAR_COUNT } from './bar-interval.ts';
import { type LayerSettings, resolveFieldSettings } from '../indicators/field-layers.ts';
import { type AddedIndicator, resolveBandKey } from '../../shared/core/indicator-selection.ts';
import { isPlanWithinBudget, recolourPlan } from '../../shared/core/draw-plan.ts';

/** How often the instrument listing and its coverage are re-read. */
/** Bars of clear space kept after the newest one. */
const RIGHT_MARGIN_BARS = 5;

/**
 * The most of the window that clear space may take.
 *
 * A handful of bars is the right amount of room until a bar is wide: five
 * minute-bars on a quarter-hour window is a third of the chart left empty, and
 * a reader looking at fifteen minutes did not ask for five of nothing.
 */
const RIGHT_MARGIN_SPAN_RATIO = 0.04;

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
    /** The bar rung the reader named, or null while the window decides. */
    readonly barIntervalMs: BarIntervalMs | null;
    /** What each drawn layer is tuned to, for the parts that paint them. */
    readonly layerSettings: LayerSettings;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
    /** Whether the stretches nothing was recorded through are marked. */
    readonly areGapsVisible: boolean;
    /** Whether the book's own traded volume is drawn, and how. */
    readonly addedIndicators: readonly AddedIndicator[];
    /** What the indicators produced for the window on screen. */
    readonly plans: readonly DrawPlan[];
    /**
     * The added layer whose settings are open, or null while none are.
     *
     * Opened by pressing what it drew rather than by finding it in a list: a
     * reader who has just pointed at a line has said which one they mean.
     */
    readonly pickedInstanceId: string | null;
}

export interface ChartControllerConfig {
    readonly api: HeatmapSource;
    readonly liveFeed: LiveFeed;
    readonly preferences: PreferencesService;
}

export interface ViewRequest {
    readonly viewport: ChartViewport;
    readonly surfaceWidthPx: number;
    /**
     * How tall the price pane is, when the caller knows.
     *
     * What decides how many rows to ask for. A fixed budget asks for rows the
     * pane has no pixels to show, and every one of them is read, sent, and
     * folded away again by the reader — and it stops a coarser level of the
     * archive from ever being free, because a level folds prices as well as
     * instants and the reader has claimed it wants every price.
     */
    readonly pricePaneHeightPx?: number;
    /** Pass false when the gesture moved the view off the right edge. */
    readonly isFollowingLive?: boolean;
    /** Pass false when the gesture chose a price band of its own. */
    readonly isFollowingPrice?: boolean;
    /**
     * True on the view a gesture leaves behind when the hand lifts.
     *
     * A drag writes a viewport every frame, and asking for a window on each of
     * them would be a request a frame. They are collected instead, and the
     * collecting costs the reader the settling time on every gesture — a fifth
     * of a second of looking at the old picture, measured against a read that
     * answers in less than that. Told which view is the last one, the window can
     * be asked for the moment the hand leaves and the collecting only ever
     * delays a movement still happening.
     */
    readonly isGestureOver?: boolean;
}

/**
 * Everything the chart knows, and the only thing that changes it.
 */
export class ChartController {
    readonly store: ObservableStore<ChartState>;

    private readonly config: ChartControllerConfig;
    private readonly windowLoader: WindowLoader;
    private surfaceWidthPx = 800;
    /** The pane prices are drawn in, until a surface says otherwise. */
    private pricePaneHeightPx = 600;
    private needsPriceFraming = true;
    /** Newest instant the tail has handed over, which is where it will resume. */
    private tailDeliveredMs = 0;
    /** The store the running tail is streaming out of. */
    private hasOpenedTail = false;
    /** The prices the running tail is reading over, as the window key spells them. */
    private tailBandKey: string | null = null;
    /** The prices the newest window was read over, which is what a tail extends. */
    private loadedPriceBand: PriceBandQuery | null = null;
    private wasDisposed = false;
    private wasInitialised = false;
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
        // A mount that runs its effects twice must not open a second live tail
        // or refetch the window it already has.
        if (this.wasInitialised) {
            return;
        }
        this.wasInitialised = true;

        try {
            const instruments = await this.config.api.fetchInstruments();
            const preferred = this.choosePreferredInstrument(instruments);

            if (preferred === null) {
                this.store.update((current) => ({ ...current, phase: 'empty', instruments }));
                return;
            }

            // Told where the market is, the chart is already framed: the very
            // first window can then ask for the band it will draw instead of
            // reading a whole book to find out where to look.
            this.needsPriceFraming = preferred.lastMidPrice === null;
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

        // Let go before the switch, not after the new window lands: a frame
        // message names no instrument, so anything the old tail delivers in
        // between is appended to the contract the reader moved to.
        this.config.liveFeed.disconnect();
        this.windowLoader.reset();
        this.needsPriceFraming = instrument.lastMidPrice === null;
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
     * Frames the price axis on what is drawn, and follows it again from there.
     *
     * The way back from a band the reader dragged, and from one a wide window
     * widened: nothing else ever shrinks the axis.
     */
    refitPrice(): void {
        this.needsPriceFraming = true;
        this.store.update((state) => ({ ...state, isFollowingPrice: true }));
        this.applyView({
            viewport: this.store.read().viewport,
            surfaceWidthPx: this.surfaceWidthPx,
        });
    }

    /**
     * Points the controls at one added layer, or at none.
     *
     * @param instanceId - The copy to open, or null to close whatever is open.
     */
    pickLayer(instanceId: string | null): void {
        if (this.store.read().pickedInstanceId === instanceId) {
            return;
        }
        this.store.update((state) => ({ ...state, pickedInstanceId: instanceId }));
    }

    /**
     * Adopts the bar rung the reader named, or hands the choice back to the window.
     *
     * @param barIntervalMs - A rung of the ladder, or null to fit the window.
     */
    selectBarInterval(barIntervalMs: BarIntervalMs | null): void {
        const current = this.store.read();
        if (current.barIntervalMs === barIntervalMs) {
            return;
        }

        this.store.update((state) => ({ ...state, barIntervalMs }));
        if (barIntervalMs === null) {
            this.persistPreferences();
            void this.loadWindow();
            return;
        }

        // Widened to hold a readable run of them. Left as it was, naming an
        // hourly bar on a quarter-hour window draws one bar the width of the
        // screen, which is a true picture of nothing.
        const toMs = current.viewport.toMs;
        this.applyView({
            viewport: { ...current.viewport, fromMs: toMs - barIntervalMs * TARGET_BAR_COUNT, toMs },
            surfaceWidthPx: this.surfaceWidthPx,
        });
    }

    /**
     * Adopts a viewport produced by a gesture and schedules any refetch it needs.
     *
     * @param request - The requested viewport and the surface it was measured on.
     */
    applyView(request: ViewRequest): void {
        this.surfaceWidthPx = Math.max(1, request.surfaceWidthPx);
        if (request.pricePaneHeightPx !== undefined) {
            this.pricePaneHeightPx = Math.max(1, request.pricePaneHeightPx);
        }
        const bounds = this.resolveBounds();
        const isFollowingLive = request.isFollowingLive ?? this.store.read().isFollowingLive;
        const viewport = this.restEdgeOnData(clampViewport(request.viewport, bounds), isFollowingLive);

        this.store.update((state) => ({
            ...state,
            viewport,
            isFollowingLive,
            isFollowingPrice: request.isFollowingPrice ?? state.isFollowingPrice,
        }));

        const loadRequest = this.buildLoadRequest();
        if (loadRequest !== null) {
            this.windowLoader.scheduleIfStale(loadRequest, request.isGestureOver === true);
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
                higher: state.dataset.higher,
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
        // Offered on every change, and refused by the loader unless the window
        // it describes actually differs. Deciding here as well meant two places
        // held the same rule, and the second one was already missing a reason:
        // a deeper indicator was listed, reading from another store was not.
        void this.loadWindow();
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
            rightMarginMs: resolveRightMarginMs(state),
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
            pricePaneHeightPx: this.pricePaneHeightPx,
            frameIntervalMs: instrument?.frameIntervalMs ?? state.dataset.sampleIntervalMs,
            priceGroupSize: resolveTradePriceGroupSize(state.viewport, state.dataset.priceBucketSize),
            warmupBars: resolveRequiredWarmupBars(state.addedIndicators),
            higherBars: resolveRequiredHigherBars(state.addedIndicators),
            barIntervalMs: state.barIntervalMs,
            sources: resolveWindowSources(state),
            // Held back until the axis has been framed on the book: before
            // that it carries a span from another session, and asking for it
            // would return the wrong slice of the market to frame on.
            priceBand: this.needsPriceFraming
                ? null
                : { lowPrice: state.viewport.lowPrice, highPrice: state.viewport.highPrice },
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

        this.loadedPriceBand = loaded.priceBand;

        // Read before the update, because framing is what clears it: the chart
        // opened on the whole book to find the market, and the band it settled
        // on is a different, far smaller window than the one it was handed.
        const wasFramingPrice = this.needsPriceFraming;

        this.store.update((current) => {
            const dataset = replaceDataset({
                instrumentSymbol: symbol,
                window: loaded.window,
                clusters: loaded.clusters,
                clusterPriceBucketSize: loaded.clusterPriceBucketSize,
                clusterIntervalMs: loaded.clusterIntervalMs,
                gaps: loaded.gaps,
                bars: loaded.bars,
                higher: loaded.higher,
                previousRevision: current.dataset.revision,
                previousSaturationQuantity: current.dataset.saturationQuantity,
                previousFloorQuantity: current.dataset.floorQuantity,
                floorPercentile: current.depthFloorPercentile,
                saturationPercentile: current.depthSaturationPercentile,
                // What the reader can see, so a wall standing in the overscan
                // does not set the top of the scale and flatten the screen.
                viewport: current.viewport,
            });
            const next = {
                ...current,
                isLoadingWindow: false,
                phase: (hasAnything(dataset) ? 'ready' : 'empty') as ChartPhase,
                failureKey: null,
                dataset,
                viewport: this.framePriceRange(current.viewport, dataset),
            };
            return { ...next, plans: this.computePlans(next) };
        });

        if (wasFramingPrice && !this.needsPriceFraming) {
            void this.loadWindow();
            return;
        }

        // A store that lags the recording answers a window ending seconds before
        // the tail has already reached, and the tail only ever resumes forward.
        // Nothing would deliver the stretch between them, and the chart would
        // hold a hole at the live edge until the next gesture refetched it.
        const newestMs = newestFrameTimestamp(this.store.read().dataset);
        // Only once there is a tail to reopen: before the first one is opened
        // there is nothing to correct, and opening here would leave the caller
        // that is about to open one holding a second socket.
        const hasTail = this.hasOpenedTail;
        // And a tail reading a band the window no longer covers leaves the
        // prices the reader has just panned onto standing still. Compared here,
        // after the window has landed, so the socket that reopens asks for the
        // band the chart actually holds rather than the one it is leaving.
        const movedBand = describeBand(this.loadedPriceBand) !== this.tailBandKey;
        if (hasTail && ((newestMs !== null && newestMs < this.tailDeliveredMs)
            || movedBand)) {
            this.openLiveTail();
        }
    }

    private openLiveTail(): void {
        const state = this.store.read();
        if (state.instrumentSymbol === null || this.wasDisposed) {
            return;
        }

        this.tailDeliveredMs = newestFrameTimestamp(state.dataset) ?? 0;
        this.hasOpenedTail = true;
        const band = this.loadedPriceBand;
        this.tailBandKey = describeBand(band);

        this.config.liveFeed.connect({
            instrumentSymbol: state.instrumentSymbol,
            afterMs: newestFrameTimestamp(state.dataset) ?? Date.now(),
            source: DRAWN_FROM,
            // A band the chart has not framed itself on yet names no prices,
            // and a tail asked for none of them reads all of them, which is
            // right: it is still looking for the market.
            ...(band === null || !(band.highPrice > band.lowPrice)
                ? {}
                : { priceBand: { lowPrice: band.lowPrice, highPrice: band.highPrice } }),
            onMessage: this.handleLiveMessage,
            onStatusChanged: this.handleLiveStatus,
        });
    }

    private handleLiveFrames(window: LiquidityFrameWindow): void {
        this.tailDeliveredMs = Math.max(
            this.tailDeliveredMs,
            window.frames[window.frames.length - 1]?.capturedAtMs ?? 0,
        );
        this.store.update((state) => {
            // The tail reads the recording as written; a window read over a wide
            // band comes folded. Appended unfolded, every price in it lands at a
            // fraction of where it belongs.
            const laid = state.dataset.frames.length === 0
                ? window
                : foldFrameWindow(window, state.dataset.priceBucketSize);
            if (laid === null) {
                return state;
            }
            const dataset = appendFrames(state.dataset, laid.frames);
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

        const onLiveEdge = followLiveEdge(state.viewport, dataset, resolveRightMarginMs(state));
        const followed = state.isFollowingPrice
            ? followDrawnPrice(onLiveEdge, dataset, {
                isDepthVisible: state.isDepthVisible,
                isCandleOverlayVisible: state.isCandleOverlayVisible,
            })
            : onLiveEdge;

        // Held to the bounds on every frame, not only when a gesture asks. An
        // archive that starts empty knows nothing of its own extent at first,
        // and a window opened wider than anything recorded would stay that
        // wide for ever: a quarter of an hour of chart holding ten seconds of
        // it, pressed into a sliver at the edge.
        return clampViewport(followed, this.resolveBounds());
    }

    /**
     * The viewport with its right edge held to the newest instant that exists.
     *
     * A reader following the recording is following the recording, not the wall
     * clock. Between gestures that is already true — the edge only ever moves
     * when a frame arrives — but a gesture pins it to the clock instead, and a
     * store written a few columns at a time is seconds behind. Those seconds
     * then sit on screen as blank, frozen there until the store catches up to
     * where the clock was, because the edge is never pulled back.
     *
     * The span is kept: a gesture that zoomed still has to zoom.
     */
    private restEdgeOnData(viewport: ChartViewport, isFollowingLive: boolean): ChartViewport {
        const state = this.store.read();
        const newestMs = newestFrameTimestamp(state.dataset);
        if (!isFollowingLive || newestMs === null) {
            return viewport;
        }

        const edgeMs = newestMs + resolveRightMarginMs({ ...state, viewport });
        if (viewport.toMs <= edgeMs) {
            return viewport;
        }
        return { ...viewport, fromMs: viewport.fromMs - (viewport.toMs - edgeMs), toMs: edgeMs };
    }

    /**
     * Frames the price axis on what is being drawn, once per instrument.
     */
    private framePriceRange(viewport: ChartViewport, dataset: ChartDataset): ChartViewport {
        if (!this.needsPriceFraming || !hasAnything(dataset)) {
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
            barIntervalMs: state.barIntervalMs,
        });
    }

    /**
     * Records a load failure without throwing away what is already on screen.
     */
    private publishFailure(error: unknown): void {
        const failureKey = resolveFailureKey(error);
        this.store.update((state) => ({
            ...state,
            phase: hasAnything(state.dataset) ? state.phase : 'failed',
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

/**
 * The bodies of data something on the chart is going to read.
 *
 * The frame window is the heaviest thing the gateway serves, and a chart with
 * the book hidden draws none of it. What reads the executions is the bubbles,
 * the profile and the traded volume, each of which the book can be showing or
 * not independently.
 */
function resolveWindowSources(state: ChartState): readonly WindowSource[] {
    const sources: WindowSource[] = [];
    if (state.isDepthVisible) {
        sources.push('frames');
    }
    if (state.isTradeOverlayVisible || state.isVolumeProfileVisible) {
        sources.push('trades');
    }
    return sources;
}

/**
 * Whether the window holds anything to draw.
 *
 * Counted across both, because which of them was fetched depends on what is on
 * the chart: a chart showing candles alone loads no book at all, and reading
 * emptiness off the book would tell it nothing was ever recorded.
 */
/**
 * Empty room kept after the newest bar.
 *
 * Measured in bars rather than pixels, so it is the same amount of chart at
 * every zoom: a handful of bars of clear space, which is what makes the one
 * being built readable instead of pressed against the axis. Capped by a share
 * of the window, because a handful of wide bars is most of a narrow one.
 */
function resolveRightMarginMs(state: ChartState): number {
    const spanMs = state.viewport.toMs - state.viewport.fromMs;
    return Math.min(
        RIGHT_MARGIN_BARS * state.dataset.bars.intervalMs,
        spanMs * RIGHT_MARGIN_SPAN_RATIO,
    );
}

function hasAnything(dataset: ChartDataset): boolean {
    return dataset.frames.length > 0 || dataset.bars.bars.length > 0;
}

function buildInitialState(preferences: ViewerPreferences): ChartState {
    const nowMs = Date.now();
    return {
        phase: 'initialising',
        failureKey: null,
        instruments: [],
        instrumentSymbol: null,
        barIntervalMs: preferences.barIntervalMs,
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
        pickedInstanceId: null,
    };
}

function buildInitialViewport(instrument: InstrumentCoverage, spanMs: number): ChartViewport {
    const toMs = instrument.lastFrameAtMs ?? Date.now();
    // Framed on the price the listing carried, so the very first window can ask
    // for the band it will draw. Without it the chart has to read a whole book
    // to find the market — measured, two seconds, with every other request on
    // the page queued behind it and nothing drawn until it landed.
    const midPrice = instrument.lastMidPrice;
    const halfRange = midPrice === null ? 0.5 : midPrice * INITIAL_PRICE_RANGE_RATIO;
    return {
        fromMs: toMs - spanMs,
        toMs,
        lowPrice: (midPrice ?? 0.5) - halfRange,
        highPrice: (midPrice ?? 0.5) + halfRange,
    };
}

function hasMovedACut(before: ChartState, after: ChartState): boolean {
    return before.depthFloorPercentile !== after.depthFloorPercentile
        || before.depthSaturationPercentile !== after.depthSaturationPercentile;
}

function recut(state: ChartState): ChartDataset {
    return recutDataset({
        dataset: state.dataset,
        floorPercentile: state.depthFloorPercentile,
        saturationPercentile: state.depthSaturationPercentile,
        viewport: state.viewport,
    });
}
