import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';
import { MAXIMUM_WINDOW_MS } from '../../shared/core/api-contract.ts';
import { type BarIntervalMs, resolveBarIntervalMs, TARGET_BAR_COUNT } from './bar-interval.ts';
import type { ChartViewport } from './chart-viewport.ts';
import type { FrameRegion } from '../../shared/core/frame-merge.ts';
import { assembleWindow, WindowCache } from './window-cache.ts';
import type { PriceBarWindow } from '../../shared/core/price-bar.ts';
import type { SessionRequest } from '../../shared/core/draw-plan.ts';
import type {
    FrameWindowQuery,
    HeatmapSource,
    PriceBandQuery,
    TradeClusterResult,
} from '../../shared/core/heatmap-source.ts';

/** Loaded window is this much wider than the view, so a short pan needs no refetch. */
const OVERSCAN_RATIO = 0.6;

/**
 * Steps the asked-for price band is snapped onto, across the visible span.
 *
 * The band goes into the request key, so an unsnapped one would be a new key on
 * every pixel of vertical drag and a refetch behind each. Snapped, the key
 * holds still until the reader has moved an eighth of what they can see, which
 * the overscan already covers.
 */
const PRICE_SNAP_STEPS = 8;

/**
 * How much wider than the view a loaded band may be before it is asked again.
 *
 * A band is asked for with overscan, so right after a load it is a little over
 * twice the view; anything past that means the reader has zoomed in since. It
 * matters because a wide band is folded to fit the row budget: the window comes
 * back on a coarser grid, and without this the chart keeps drawing that grid
 * however far in the reader goes — the axis narrows and the rows do not.
 */
const WIDEST_LOADED_BAND_RATIO = 4;

/**
 * Most price rows a window is ever asked for.
 *
 * A ceiling, not the usual answer: the rows asked for follow the pane, and this
 * only catches a caller that has not said how tall its pane is.
 */
const MAXIMUM_ROWS = 1_200;

/**
 * How tall a drawn row is, at least.
 *
 * The same floor the field paints on. Rows are asked for at this height so that
 * what arrives is what can be shown: asked for finer, every extra row is read,
 * sent, and folded away again by the reader — and a whole-book store cannot
 * answer off a coarser level, because a level folds prices as well as instants
 * and a reader asking for every price has said it wants them all.
 */
const MINIMUM_ROW_HEIGHT_PX = 3;

/** Quiet stretch after a read before the way ahead is read too. */
const WARM_AFTER_QUIET_MS = 450;

/**
 * How far ahead of the reader to read, as a share of what is on screen.
 *
 * Nearly a screen, because that is about as far as one gesture carries: a drag
 * across the plot moves the view by most of its own width, and a reader who has
 * just done one is about to do it again.
 */
const WARM_SHARE = 0.9;

/** Gesture settling time before a refetch; a pinch fires dozens of viewport writes. */
const RELOAD_DEBOUNCE_MS = 220;

/** Executions binned finer than this per column are indistinguishable on screen. */
const TARGET_TRADE_COLUMNS = 420;

const MAXIMUM_COLUMNS = 4_000;
const MINIMUM_COLUMNS = 120;

/** Bars a window shows. */

export interface LoadedWindow {
    readonly window: LiquidityFrameWindow;
    /**
     * The prices this window was asked for, snapped as the request carried them.
     *
     * A tail extends this window, so it has to ask for the same prices: asking
     * for fewer leaves a notch at the live edge, and asking for all of them is
     * what the band was introduced to stop.
     */
    readonly priceBand: PriceBandQuery | null;
    readonly bars: PriceBarWindow;
    /** Coarser rungs, for whatever on the chart declared it reads one. */
    readonly higher: ReadonlyMap<number, PriceBarWindow>;
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
    /** Coarser rungs to fetch alongside, for whatever reads one. */
    readonly sessions: readonly SessionRequest[];
    /**
     * What something on the chart is going to read.
     *
     * Declared by the caller rather than assumed, so a chart drawing none of
     * the book does not fetch it.
     */
    readonly sources: readonly WindowSource[];
    /**
     * The prices the reader is looking at, or null for every price stored.
     *
     * Null while the chart has not framed itself on the book yet: until then
     * the price axis is a leftover from another session, and clipping to it
     * would answer with the wrong slice of the market to frame on.
     */
    readonly priceBand: { readonly lowPrice: number; readonly highPrice: number } | null;
    /** How tall the pane prices are drawn in, for the rows to ask for. */
    readonly pricePaneHeightPx?: number;
}

/** The bodies of data a window may hold. */
export type WindowSource = 'frames' | 'trades';

/**
 * The band a request will carry, snapped so a short pan reuses the last one.
 *
 * @param request - What the reader is looking at.
 * @returns The band, or null when the chart has not framed itself yet.
 */
function resolvePriceBandQuery(request: WindowLoadRequest): PriceBandQuery | null {
    const maxRows = resolveMaxRows(request);
    const band = request.priceBand;
    if (band === null || !(band.highPrice > band.lowPrice)) {
        // Rows without prices: a chart that has not framed itself still must
        // not be sent every price in the market to find the one it is on.
        return { lowPrice: 0, highPrice: 0, maxRows };
    }

    const span = band.highPrice - band.lowPrice;
    const step = span / PRICE_SNAP_STEPS;
    const margin = span * OVERSCAN_RATIO;
    // Only the low edge is snapped, and the width follows it exactly. Snapping
    // both, the width wobbles by a step as the reader pans, and a band a step
    // wider is a band folded onto another grid — so nothing already held could
    // ever be kept across a pan, which is the whole point of snapping.
    const lowPrice = Math.max(0, Math.floor((band.lowPrice - margin) / step) * step);
    return {
        lowPrice,
        highPrice: lowPrice + span + margin * 2,
        maxRows,
    };
}

/**
 * How many rows the pane on screen can actually show over the band asked for.
 *
 * The band reaches past the view on both sides, so it needs that much more than
 * the pane holds — the overscan is there so a short pan needs no refetch, and a
 * band with no rows behind it would refetch on the first one.
 */
function resolveMaxRows(request: WindowLoadRequest): number {
    const paneHeightPx = request.pricePaneHeightPx;
    if (paneHeightPx === undefined || !(paneHeightPx > 0)) {
        return MAXIMUM_ROWS;
    }
    const overscanned = paneHeightPx * (1 + 2 * OVERSCAN_RATIO);
    return Math.max(1, Math.min(MAXIMUM_ROWS, Math.ceil(overscanned / MINIMUM_ROW_HEIGHT_PX)));
}

/**
 * The band as it appears in a request key.
 *
 * Exported because the tail is keyed off it too: a tail reads over the band the
 * window it extends was read over, so it has to be reopened when, and only
 * when, that band moves. Keyed off anything narrower and a reader panning the
 * price axis is fed the strip they left; off anything wider and every gesture
 * tears the socket down and puts a hole at the live edge while it comes back.
 *
 * @param band - The band a request carried, or null for none.
 * @returns A string equal for two bands that would be read the same.
 */
export function describeBand(band: PriceBandQuery | null): string {
    return band === null ? '' : `${Math.round(band.lowPrice)}-${Math.round(band.highPrice)}`;
}

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
    private loadedLowPrice = Number.NEGATIVE_INFINITY;
    private loadedHighPrice = Number.POSITIVE_INFINITY;
    private loadedSampleIntervalMs = Number.POSITIVE_INFINITY;
    private loadedWarmupBars = 0;
    /** What the reader has already been given, so it is not asked for twice. */
    private readonly cache = new WindowCache();
    /**
     * Where the last read began, or null before there has been one.
     *
     * Null rather than nought, because a first read is not a movement: measured
     * against nothing, it looks like a reader travelling backwards through the
     * whole of history, and the chart would open by reading twice.
     */
    private warmedFromMs: number | null = null;
    /** How wide the last read was, for telling a pan from a zoom. */
    private warmedSpanMs = 0;
    private warmingTimer: ReturnType<typeof setTimeout> | null = null;
    private warmingAhead: {
        request: WindowLoadRequest; range: ResolvedRange; heading: number;
    } | null = null;
    private warmingRequest: AbortController | null = null;
    private lastRequestedKey = '';
    private reloadTimer: ReturnType<typeof setTimeout> | null = null;
    private inFlight: AbortController | null = null;
    private pendingRequest: WindowLoadRequest | null = null;
    private wasDisposed = false;

    constructor(config: WindowLoaderConfig) {
        this.config = config;
        this.handleReloadDue = this.handleReloadDue.bind(this);
        this.handleWarmingDue = this.handleWarmingDue.bind(this);
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

        this.dropWarming();
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
            // A band that names no prices is a whole-book window: nothing the
            // reader can look at falls outside it, and calling it stale would
            // have every gesture schedule a reload the key then throws away.
            const band = range.priceBand;
            const named = band !== null && band.highPrice > band.lowPrice;
            this.loadedLowPrice = named ? band.lowPrice : Number.NEGATIVE_INFINITY;
            this.loadedHighPrice = named ? band.highPrice : Number.POSITIVE_INFINITY;
            this.loadedSampleIntervalMs = loaded.window.sampleIntervalMs;
            this.loadedWarmupBars = request.warmupBars;
            this.config.onLoaded(loaded);
            this.warmTheWayAhead(request, range);
        } catch (error) {
            this.lastRequestedKey = '';
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            this.config.onFailed(error);
        } finally {
            // Cleared so that what comes after — reading the way ahead — can
            // tell a read that is still running from one that has finished.
            if (this.inFlight === abortController) {
                this.inFlight = null;
            }
        }
    }

    /**
     * Queues a fetch when the view has outgrown what is loaded.
     *
     * @param request - Instrument, viewport, surface width, and price binning.
     */
    scheduleIfStale(request: WindowLoadRequest, isGestureOver = false): void {
        if (this.isDisposed || !this.isStale(request)) {
            return;
        }

        this.pendingRequest = request;
        if (this.reloadTimer !== null) {
            clearTimeout(this.reloadTimer);
            this.reloadTimer = null;
        }
        // Nothing more is coming, so there is nothing to wait for. The settling
        // time is for a hand still moving; spent after it has lifted it is a
        // fifth of a second of the old picture for no reason.
        if (isGestureOver) {
            this.handleReloadDue();
            return;
        }
        this.reloadTimer = setTimeout(this.handleReloadDue, RELOAD_DEBOUNCE_MS);
    }

    /**
     * Reads the stretch the reader is heading into, once they have stopped.
     *
     * A reader panning does it again: the same drag, the same direction, a
     * second later. Read while nothing else is going on, the next one costs
     * nothing at all — and if they stop instead, one read was spent on a
     * stretch nobody looked at, which is the whole of the wager.
     *
     * Never in the way. It waits out a quiet stretch, it is dropped the moment
     * a real read starts, and what it finds goes to the cache and nowhere near
     * the chart.
     */
    private warmTheWayAhead(request: WindowLoadRequest, range: ResolvedRange): void {
        // Only after a pan. A zoom moves where the window starts as well, but
        // it lands on another level of the archive, so nothing read ahead of it
        // could be used — and the wager is about a gesture being repeated,
        // which a zoom in one direction rarely is.
        const wasPan = this.warmedSpanMs === range.toMs - range.fromMs;
        const heading = this.warmedFromMs === null || !wasPan
            ? 0
            : Math.sign(range.fromMs - this.warmedFromMs);
        this.warmedFromMs = range.fromMs;
        this.warmedSpanMs = range.toMs - range.fromMs;
        if (this.warmingTimer !== null) {
            clearTimeout(this.warmingTimer);
        }
        if (heading === 0) {
            return;
        }
        this.warmingAhead = { request, range, heading };
        this.warmingTimer = setTimeout(this.handleWarmingDue, WARM_AFTER_QUIET_MS);
    }

    private handleWarmingDue(): void {
        this.warmingTimer = null;
        const ahead = this.warmingAhead;
        if (ahead === null || this.isDisposed || this.inFlight !== null) {
            return;
        }
        // A step of what is on SCREEN, not of what was loaded. The window
        // loaded reaches well past the view on both sides, so stepping by its
        // width lands twice as far ahead as the reader will ever get in one
        // gesture — and the read is spent on a stretch they never reach.
        const onScreenMs = ahead.request.viewport.toMs - ahead.request.viewport.fromMs;
        const step = onScreenMs * WARM_SHARE * ahead.heading;
        void this.warm(ahead.request, ahead.range, {
            ...toRegion(ahead.range),
            fromMs: ahead.range.fromMs + step,
            toMs: ahead.range.toMs + step,
        });
    }

    /** Reads a region into the cache without telling anyone about it. */
    private async warm(
        request: WindowLoadRequest,
        range: ResolvedRange,
        wanted: FrameRegion,
    ): Promise<void> {
        const plan = this.cache.plan(range.stitchKey, wanted);
        if (plan.missing.length === 0) {
            return;
        }
        const warming = new AbortController();
        this.warmingRequest = warming;
        const frameQuery = toFrameQuery(request, range);
        try {
            const pieces = await Promise.all(plan.missing.map((region) => (
                this.config.api.fetchFrameWindow(
                    toPieceQuery(frameQuery, range, region),
                    warming.signal,
                )
            )));
            const assembled = assembleWindow([plan.held, ...pieces], wanted);
            if (assembled !== null && !warming.signal.aborted) {
                this.cache.keep(range.stitchKey, wanted, assembled);
            }
        } catch {
            // Nothing asked for this, so nothing is waiting on it. A reader who
            // moved on had it dropped on purpose.
        } finally {
            if (this.warmingRequest === warming) {
                this.warmingRequest = null;
            }
        }
    }

    /** Stops whatever was being read ahead, for a reader who has moved on. */
    private dropWarming(): void {
        if (this.warmingTimer !== null) {
            clearTimeout(this.warmingTimer);
            this.warmingTimer = null;
        }
        this.warmingRequest?.abort();
        this.warmingRequest = null;
    }

    /**
     * Forgets what is loaded, so the next request always fetches.
     */
    reset(): void {
        this.cache.clear();
        this.warmedFromMs = null;
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
        this.dropWarming();
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

        // A window clipped to a band holds nothing above or below it, so a
        // reader who panned the price axis off the loaded band is looking at
        // blank chart until it is asked for again.
        const isOutsideBand = viewport.lowPrice < this.loadedLowPrice
            || viewport.highPrice > this.loadedHighPrice;

        // And a band far wider than the view was asked for at a zoom the reader
        // has left. It was folded to fit the rows, so it is drawn coarser than
        // this view could be: without asking again, zooming in narrows the axis
        // and never sharpens the grid.
        const loadedBand = this.loadedHighPrice - this.loadedLowPrice;
        const isBandTooWide = Number.isFinite(loadedBand)
            && (viewport.highPrice - viewport.lowPrice) * WIDEST_LOADED_BAND_RATIO < loadedBand;

        return isOutsideLoaded || isTooCoarse || isShallow || isOutsideBand || isBandTooWide;
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
        });

        return {
            fromMs,
            toMs,
            maxColumns,
            barIntervalMs,
            priceBand: resolvePriceBandQuery(request),
            // What has to be equal for two reads to answer on the same grid,
            // and so for one to be able to add to the other. The span chooses
            // the level of the archive a read comes off, and the WIDTH of the
            // band chooses how many prices go into a row — but where the band
            // sits does not, which is what lets a reader who has moved up or
            // down keep what it already had.
            stitchKey: [
                request.symbol,
                maxColumns,
                Math.round(toMs - fromMs),
                Math.round(bandWidthOf(resolvePriceBandQuery(request))),
            ].join('|'),
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
                // And a coarser rung is history of another kind. A reading
                // anchored to a session, added over a window already held,
                // changes nothing about the range: without this its fetch is
                // deduplicated against the one that had no rung to fetch.
                describeRungs(request.sessions),
                // Turning the book on has to fetch what it draws, and the range
                // it is drawn over has not moved. Reading the same range out of
                // another store is the same kind of change: without this the
                // switch is deduplicated against the window already held.
                [...request.sources].sort().join(','),
                // The band is part of what was asked for: without it a reader
                // who panned the price axis would be handed the slice from
                // where they were, deduplicated against the request they made.
                describeBand(resolvePriceBandQuery(request)),
            ].join('|'),
        };
    }

    /**
     * The window asked for, asking only for the stretch not already held.
     *
     * A reader panning already has most of what it is about to ask for: the
     * window loaded reaches well past the view on both sides, so a pan of most
     * of a screen still leaves half of the new window inside the old one.
     * Fetched whole every time, that half is read from the archive, sent, and
     * decoded again to arrive at instants the reader is already holding.
     *
     * Only ever a shortcut. Every read carries the grid it was answered on, and
     * a piece that came back on a different one is thrown away and the whole
     * window asked for instead — a grid is what makes two pieces the same
     * picture, and nothing else about the request guarantees it.
     */
    private async readFrameWindow(
        frameQuery: FrameWindowQuery,
        range: ResolvedRange,
        signal: AbortSignal,
    ): Promise<LiquidityFrameWindow> {
        const wanted = toRegion(range);
        const plan = this.cache.plan(range.stitchKey, wanted);
        if (plan.missing.length === 0 && plan.held !== null) {
            return plan.held;
        }

        const pieces = await Promise.all(plan.missing.map((region) => (
            this.config.api.fetchFrameWindow(toPieceQuery(frameQuery, range, region), signal)
        )));
        const assembled = assembleWindow([plan.held, ...pieces], wanted);
        if (assembled === null) {
            // The pieces did not come back on the grid the held one is on, and
            // a grid is what makes two readings the same picture. Nothing about
            // the request guarantees it, so the whole thing is asked for again.
            const whole = await this.config.api.fetchFrameWindow(frameQuery, signal);
            this.cache.keep(range.stitchKey, wanted, whole);
            return whole;
        }
        this.cache.keep(range.stitchKey, wanted, assembled);
        return assembled;
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
        const frameQuery = toFrameQuery(request, range);
        const readFrames = () => this.readFrameWindow(frameQuery, range, signal);

        // Only what something on the chart is going to read. The frame window
        // is by far the heaviest thing the gateway serves, and a chart showing
        // candles alone was paying for it on every fetch to draw nothing.
        const wanted = new Set(request.sources);
        const [window, tradeResult, gaps, bars, higher] = await Promise.all([
            wanted.has('frames') ? readFrames() : Promise.resolve(EMPTY_FRAME_WINDOW),
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
            this.readHigherBars(request, range, signal),
        ]);

        return {
            window,
            priceBand: range.priceBand,
            bars,
            higher,
            clusters: tradeResult.clusters,
            clusterPriceBucketSize: tradeResult.priceBucketSize,
            clusterIntervalMs: tradeResult.sampleIntervalMs,
            gaps,
        };
    }

    /**
     * The coarser windows whatever is on the chart declared it reads.
     *
     * A rung that cannot be answered is dropped rather than raised. No venue
     * publishes a candle for every width, and a reading that wanted one it
     * cannot have should draw nothing and say so — not take the window that
     * every other layer on the chart is waiting on down with it.
     */
    private async readHigherBars(
        request: WindowLoadRequest,
        range: ResolvedRange,
        signal: AbortSignal,
    ): Promise<ReadonlyMap<number, PriceBarWindow>> {
        const over = { symbol: request.symbol, fromMs: range.fromMs, toMs: range.toMs };
        const settled = await Promise.all(request.sessions.map(
            (one) => this.readOneRung(one, over, signal),
        ));

        return new Map(settled
            .filter((window) => window !== null)
            .map((window) => [window.intervalMs, window]));
    }

    private async readOneRung(
        rung: SessionRequest,
        over: { readonly symbol: string; readonly fromMs: number; readonly toMs: number },
        signal: AbortSignal,
    ): Promise<PriceBarWindow | null> {
        try {
            return await this.config.api.fetchPriceBars({
                ...over,
                intervalMs: rung.intervalMs,
                warmupBars: rung.reachingBack,
            }, signal);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw error;
            }
            return null;
        }
    }
}


/**
 * The coarser rungs a request carries, as one comparable string.
 *
 * @param rungs - What the readings on the chart between them asked for.
 * @returns The rungs and their depths, in an order two equal requests share.
 */
function describeRungs(rungs: readonly SessionRequest[]): string {
    return [...rungs]
        .map((one) => `${one.intervalMs}:${one.reachingBack}`)
        .sort()
        .join(',');
}

/** How a window of instants is asked for, over the whole of a range. */
function toFrameQuery(request: WindowLoadRequest, range: ResolvedRange): FrameWindowQuery {
    return {
        symbol: request.symbol,
        fromMs: range.fromMs,
        toMs: range.toMs,
        maxColumns: range.maxColumns,
        ...(range.priceBand === null ? {} : { priceBand: range.priceBand }),
    };
}

/** How wide a band is, or nought when the reader named none. */
function bandWidthOf(band: PriceBandQuery | null): number {
    return band === null ? 0 : band.highPrice - band.lowPrice;
}

/**
 * The instants and prices a resolved range covers.
 *
 * A band naming no prices is a reader that has not framed itself on the book
 * yet, and it means every price rather than none: taken literally it is a
 * region with no height, which shares nothing with anything.
 */
function toRegion(range: ResolvedRange): FrameRegion {
    const band = range.priceBand;
    const namesPrices = band !== null && band.highPrice > band.lowPrice;
    return {
        fromMs: range.fromMs,
        toMs: range.toMs,
        lowPrice: namesPrices ? band.lowPrice : 0,
        highPrice: namesPrices ? band.highPrice : Number.MAX_SAFE_INTEGER,
    };
}

/**
 * The query for one stretch of a window, asked for on the window's own grid.
 *
 * Columns and rows in the same proportion as the stretch. What the archive
 * answers on is decided by how much time one drawn column covers and how many
 * prices one drawn row holds, so a smaller stretch asked for with the whole
 * window's budget comes back finer in both — which is a different picture, and
 * one that cannot be laid beside the rest.
 */
function toPieceQuery(
    frameQuery: FrameWindowQuery,
    range: ResolvedRange,
    region: FrameRegion,
): FrameWindowQuery {
    const timeShare = (region.toMs - region.fromMs) / Math.max(1, range.toMs - range.fromMs);
    const band = range.priceBand;
    const namesPrices = band !== null && band.highPrice > band.lowPrice;
    const priceShare = namesPrices
        ? (region.highPrice - region.lowPrice) / (band.highPrice - band.lowPrice)
        : 1;
    return {
        ...frameQuery,
        fromMs: region.fromMs,
        toMs: region.toMs,
        maxColumns: Math.max(1, Math.round(range.maxColumns * timeShare)),
        ...(band === null ? {} : {
            // A region standing for every price is bounded by the largest
            // number there is, which is arithmetic for deciding what a cache
            // already holds and not a price anyone can be asked for. Sent as
            // one, it asks the archive to lay out every row between nought and
            // nine quadrillion, and the answer is a failure the reader is told
            // to blame on the recording.
            priceBand: namesPrices
                ? {
                    lowPrice: region.lowPrice,
                    highPrice: region.highPrice,
                    maxRows: Math.max(1, Math.round(band.maxRows * priceShare)),
                }
                : { lowPrice: 0, highPrice: 0, maxRows: band.maxRows },
        }),
    };
}



interface ResolvedRange {
    readonly fromMs: number;
    readonly toMs: number;
    readonly maxColumns: number;
    readonly barIntervalMs: number;
    readonly priceBand: PriceBandQuery | null;
    readonly key: string;
    /** Equal for two reads that will be answered on the same grid. */
    readonly stitchKey: string;
}
