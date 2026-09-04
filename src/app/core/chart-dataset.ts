import type { ChartViewport } from './chart-viewport.ts';
import type { LiquidityFrame, LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import { EMPTY_BAR_WINDOW, type PriceBarWindow } from '../../shared/core/price-bar.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';
import { resolveDepthRange } from '../indicators/book/depth-colour-scale.ts';

/** Quantities inspected when picking the saturation point, at most. */
const SATURATION_SAMPLE_LIMIT = 40_000;

/** Where resting size stops brightening; above this the whole field washes out. */
export const DEFAULT_SATURATION_PERCENTILE = 0.995;


/**
 * How far the saturation point must move before it is adopted.
 */
const SATURATION_HYSTERESIS = 0.25;

/** Everything currently loaded for one instrument, as one immutable snapshot. */
export interface ChartDataset {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    /** Grid the window was sampled onto; live frames land on the same grid. */
    readonly sampleIntervalMs: number;
    readonly clusterPriceBucketSize: number;
    /** Time grid the executions were binned onto, which is coarser than the frames'. */
    readonly clusterIntervalMs: number;
    readonly frames: readonly LiquidityFrame[];
    readonly clusters: readonly TradeCluster[];
    readonly gaps: readonly RecordingGap[];
    /** Bars on a declared interval, warm-up included at the front. */
    readonly bars: PriceBarWindow;
    /** Coarser rungs, for whatever on the chart declared it reads one. */
    readonly higher: ReadonlyMap<number, PriceBarWindow>;
    /**
     * Resting size that reaches the hot end of the ramp.
     */
    readonly saturationQuantity: number;
    /** Resting size below which the field reads as empty. */
    readonly floorQuantity: number;
    /** Increments on every change, so a renderer can cache against it. */
    readonly revision: number;
}

export const EMPTY_DATASET: ChartDataset = {
    instrumentSymbol: '',
    priceBucketSize: 1,
    sampleIntervalMs: 1_000,
    clusterPriceBucketSize: 1,
    clusterIntervalMs: 1_000,
    frames: [],
    clusters: [],
    gaps: [],
    bars: EMPTY_BAR_WINDOW,
    higher: new Map(),
    saturationQuantity: 1,
    floorQuantity: 0,
    revision: 0,
};

export interface DatasetReplaceRequest {
    readonly instrumentSymbol: string;
    readonly window: LiquidityFrameWindow;
    readonly clusters: readonly TradeCluster[];
    readonly clusterPriceBucketSize: number;
    /** Time grid the executions were binned onto, which is coarser than the frames'. */
    readonly clusterIntervalMs: number;
    readonly gaps: readonly RecordingGap[];
    readonly bars: PriceBarWindow;
    readonly higher: ReadonlyMap<number, PriceBarWindow>;
    readonly previousRevision: number;
    /** Floor the previous window was drawn with, held to stop a pan recolouring the field. */
    readonly previousFloorQuantity?: number;
    readonly floorPercentile: number;
    readonly saturationPercentile: number;
    /** Saturation already on screen, kept when the new window barely differs. */
    readonly previousSaturationQuantity?: number;
    /**
     * What the reader can actually see of the window.
     *
     * The window loaded reaches well past the view on both sides, in time and
     * in price, so that a short pan needs no round trip. Coloured from the whole
     * of it, a wall standing just off the screen sets the top of the scale and
     * everything on the screen is drawn at the dark end of it — the chart goes
     * flat because of liquidity nobody is looking at.
     */
    readonly viewport?: ChartViewport;
}

/**
 * Builds a dataset from a freshly loaded window.
 *
 * @param request - The window and its companions, plus the revision to advance.
 * @returns The new snapshot.
 */
export function replaceDataset(request: DatasetReplaceRequest): ChartDataset {
    return {
        instrumentSymbol: request.instrumentSymbol,
        priceBucketSize: request.window.priceBucketSize,
        sampleIntervalMs: Math.max(1, request.window.sampleIntervalMs),
        clusterPriceBucketSize: request.clusterPriceBucketSize,
        clusterIntervalMs: Math.max(1, request.clusterIntervalMs),
        frames: request.window.frames,
        clusters: request.clusters,
        gaps: request.gaps,
        bars: request.bars,
        higher: request.higher,
        ...resolveStableDepthRange(request),
        revision: request.previousRevision + 1,
    };
}

/**
 * The two ramp cuts for this window, each held steady against small drift.
 *
 * @param request - The window being adopted, carrying what was on screen before.
 * @returns The floor and saturation to draw with.
 */
function resolveStableDepthRange(request: DatasetReplaceRequest): {
    floorQuantity: number;
    saturationQuantity: number;
} {
    const measured = resolveDepthRange(
        sampleQuantities(onScreenFrames(request), request.window, request.viewport),
        request.floorPercentile,
        request.saturationPercentile,
    );

    return {
        floorQuantity: chooseSaturation(measured.floorQuantity, request.previousFloorQuantity),
        saturationQuantity: chooseSaturation(
            measured.saturationQuantity,
            request.previousSaturationQuantity,
        ),
    };
}

/**
 * Keeps the saturation already on screen unless the window genuinely differs.
 *
 * @param measured - Percentile of the window just loaded.
 * @param previous - Saturation the previous window was drawn with.
 * @returns The saturation to draw with.
 */
function chooseSaturation(measured: number, previous: number | undefined): number {
    if (previous === undefined || previous <= 0) {
        return measured;
    }
    const drift = Math.abs(measured - previous) / previous;
    return drift < SATURATION_HYSTERESIS ? previous : measured;
}

/** The instants of the window the reader can see, or all of them when unknown. */
function onScreenFrames(request: DatasetReplaceRequest): readonly LiquidityFrame[] {
    const viewport = request.viewport;
    if (viewport === undefined) {
        return request.window.frames;
    }
    const onScreen = request.window.frames.filter(
        (frame) => frame.capturedAtMs >= viewport.fromMs && frame.capturedAtMs <= viewport.toMs,
    );
    // A view that has landed outside what was loaded still has to be coloured
    // from something, and the window is the only something there is.
    return onScreen.length === 0 ? request.window.frames : onScreen;
}

/** What a fresh cut of the colour scale is made from. */
export interface DatasetRecutRequest {
    readonly dataset: ChartDataset;
    readonly floorPercentile: number;
    readonly saturationPercentile: number;
    /** What the reader can see, so a wall off the screen does not set the top. */
    readonly viewport?: ChartViewport;
}

/**
 * Reads a bounded, evenly spread sample of the resting sizes a reader can see.
 */
function sampleQuantities(
    frames: readonly LiquidityFrame[],
    grid: { readonly priceBucketSize: number },
    viewport: ChartViewport | undefined,
): number[] {
    const totalQuantities = frames.reduce(
        (running, frame) => running + frame.bids.quantities.length + frame.asks.quantities.length,
        0,
    );
    const stride = Math.max(1, Math.ceil(totalQuantities / SATURATION_SAMPLE_LIMIT));
    const band = toBucketBand(grid, viewport);

    const sampled: number[] = [];
    let cursor = 0;
    for (const frame of frames) {
        for (const ladder of [frame.bids, frame.asks]) {
            cursor = collectSide({
                quantities: ladder.quantities,
                lowestBucketIndex: ladder.lowestBucketIndex,
                band,
                stride,
                startCursor: cursor,
                sampled,
            });
        }
    }
    return sampled;
}

/** The buckets the reader can see, or every bucket when the view is unknown. */
function toBucketBand(
    grid: { readonly priceBucketSize: number },
    viewport: ChartViewport | undefined,
): { lowest: number; highest: number } {
    if (viewport === undefined || !(grid.priceBucketSize > 0)) {
        return { lowest: Number.NEGATIVE_INFINITY, highest: Number.POSITIVE_INFINITY };
    }
    return {
        lowest: Math.floor(viewport.lowPrice / grid.priceBucketSize),
        highest: Math.ceil(viewport.highPrice / grid.priceBucketSize),
    };
}

/**
 * Samples one side of one frame into the running list.
 *
 * Named because the two figures that drive it are both numbers — how often to
 * take one, and how far through the window we are — and transposed they compile
 * into a sample of the wrong every-nth bucket.
 */
interface SideSample {
    readonly quantities: Float32Array;
    readonly lowestBucketIndex: number;
    readonly band: { lowest: number; highest: number };
    readonly stride: number;
    readonly startCursor: number;
    readonly sampled: number[];
}

function collectSide(sample: SideSample): number {
    const { quantities, stride, sampled, band, lowestBucketIndex } = sample;
    let cursor = sample.startCursor;
    for (let offset = 0; offset < quantities.length; offset += 1) {
        const bucketIndex = lowestBucketIndex + offset;
        if (cursor % stride === 0 && bucketIndex >= band.lowest && bucketIndex <= band.highest) {
            const quantity = quantities[offset]!;
            if (quantity > 0) {
                sampled.push(quantity);
            }
        }
        cursor += 1;
    }
    return cursor;
}

/**
 * Merges newly streamed frames into a dataset.
 *
 * @param dataset - The snapshot to extend.
 * @param frames - Newly arrived frames, in capture order.
 * @returns The extended snapshot, or the original when nothing was new.
 */
export function appendFrames(
    dataset: ChartDataset,
    frames: readonly LiquidityFrame[],
): ChartDataset {
    if (frames.length === 0) {
        return dataset;
    }

    const newestLoadedMs = dataset.frames[dataset.frames.length - 1]?.capturedAtMs ?? -Infinity;
    const freshFrames = frames.filter((frame) => frame.capturedAtMs > newestLoadedMs);
    if (freshFrames.length === 0) {
        return dataset;
    }

    return {
        ...dataset,
        frames: [...dataset.frames, ...freshFrames],
        bars: foldFramesIntoBars(dataset.bars, freshFrames),
        revision: dataset.revision + 1,
    };
}

/**
 * Folds newly recorded frames into the bar they belong to.
 *
 * The tail delivers raw seconds; a bar is a grid over them. Without this the
 * bars stand still while the depth field runs on, because a refetch is only
 * scheduled by a gesture — an idle chart would be minutes behind itself.
 *
 * @param window - The bars as they stand.
 * @param frames - Frames the tail just delivered.
 * @returns The bars with the newest ones extended, or the original when nothing
 *          arrived that they did not already hold.
 */
export function foldFramesIntoBars(
    window: PriceBarWindow,
    frames: readonly LiquidityFrame[],
): PriceBarWindow {
    const intervalMs = Math.max(1, window.intervalMs);
    const newestHeldMs = window.bars[window.bars.length - 1]?.lastFrameAtMs ?? -Infinity;
    const fresh = frames.filter((frame) => frame.capturedAtMs > newestHeldMs);
    if (fresh.length === 0) {
        return window;
    }

    const bars = [...window.bars];
    for (const frame of fresh) {
        const openedAtMs = Math.floor(frame.capturedAtMs / intervalMs) * intervalMs;
        const midPrice = (frame.bestBidPrice + frame.bestAskPrice) / 2;
        const last = bars[bars.length - 1];

        if (last === undefined || last.openedAtMs !== openedAtMs) {
            // The bucket behind this one is over, so nothing more can belong to
            // it. Left open it would read as still being built for the rest of
            // the session, and the chart would draw it hollow beside bars that
            // are no more finished than it is.
            if (last !== undefined) {
                bars[bars.length - 1] = { ...last, isClosed: true };
            }
            bars.push({
                openedAtMs,
                closedAtMs: openedAtMs + intervalMs,
                openPrice: midPrice,
                highPrice: midPrice,
                lowPrice: midPrice,
                closePrice: midPrice,
                buyVolume: 0,
                sellVolume: 0,
                tradeCount: 0,
                expectedFrames: last?.expectedFrames ?? 1,
                frameCount: 1,
                isClosed: false,
                firstFrameAtMs: frame.capturedAtMs,
                lastFrameAtMs: frame.capturedAtMs,
            });
            continue;
        }

        bars[bars.length - 1] = {
            ...last,
            highPrice: Math.max(last.highPrice, midPrice),
            lowPrice: Math.min(last.lowPrice, midPrice),
            closePrice: midPrice,
            frameCount: last.frameCount + 1,
            lastFrameAtMs: frame.capturedAtMs,
        };
    }

    return { ...window, bars };
}

/**
 * Merges a gap the tail just reported into a dataset.
 *
 * @param dataset - The snapshot to extend.
 * @param gap - The stretch that went unrecorded.
 * @returns The extended snapshot, or the original when it is already known.
 */
export function appendGap(dataset: ChartDataset, gap: RecordingGap): ChartDataset {
    const isKnown = dataset.gaps.some(
        (existing) => existing.gapStartedAtMs === gap.gapStartedAtMs,
    );
    if (isKnown) {
        return dataset;
    }

    return {
        ...dataset,
        gaps: [...dataset.gaps, gap].sort((left, right) => left.gapStartedAtMs - right.gapStartedAtMs),
        revision: dataset.revision + 1,
    };
}

/**
 * Merges newly streamed executions into a dataset.
 *
 * @param dataset - The snapshot to extend.
 * @param clusters - Newly arrived clusters, on the stored price grid.
 * @returns The extended snapshot, or the original when nothing was new.
 */
// The live tail bins on the stored price grid while a wide window is loaded on
// a coarser one, so an arrival has to be re-binned or it lands off the grid.
/**
 * The dataset with newer executions folded into it.
 *
 * @param dataset - What the chart holds.
 * @param clusters - The buckets that arrived, oldest first.
 * @returns The dataset, or the one given where nothing arrived.
 */
export function appendClusters(
    dataset: ChartDataset,
    clusters: readonly TradeCluster[],
): ChartDataset {
    if (clusters.length === 0) {
        return dataset;
    }

    // The newest bucket is included, not skipped: it is still filling, and the
    // tail re-reads it whole on every pass. Treated as already known it would
    // stay frozen at whatever had landed the first time, so every live bucket
    // would end up drawn short of what traded in it.
    const newestLoadedMs = dataset.clusters[dataset.clusters.length - 1]?.executedAtMs ?? -Infinity;
    const groupSize = Math.max(1, Math.round(dataset.clusterPriceBucketSize / dataset.priceBucketSize));
    const arrivals = clusters
        .filter((cluster) => cluster.executedAtMs >= newestLoadedMs)
        .map((cluster) => (groupSize === 1
            ? cluster
            : { ...cluster, priceBucketIndex: Math.floor(cluster.priceBucketIndex / groupSize) }));

    if (arrivals.length === 0) {
        return dataset;
    }

    // Whole buckets are replaced rather than added to, because each arrival
    // carries a bucket's running total and not what changed since the last one.
    const rewrittenFromMs = arrivals.reduce(
        (earliest, cluster) => Math.min(earliest, cluster.executedAtMs),
        Number.POSITIVE_INFINITY,
    );
    const kept = dataset.clusters.filter((cluster) => cluster.executedAtMs < rewrittenFromMs);
    const freshClusters = arrivals.filter((cluster) => cluster.executedAtMs > newestLoadedMs);

    return {
        ...dataset,
        // Only what is genuinely new moves the forming bar; a bucket read again
        // would otherwise count its volume once per pass.
        bars: absorbIntoFormingBar(dataset.bars, freshClusters),
        clusters: [...kept, ...arrivals],
        revision: dataset.revision + 1,
    };
}

/**
 * Instant of the newest loaded frame.
 *
 * @param dataset - The snapshot to inspect.
 * @returns Unix milliseconds, or null when nothing is loaded.
 */
export function newestFrameTimestamp(dataset: ChartDataset): number | null {
    return dataset.frames[dataset.frames.length - 1]?.capturedAtMs ?? null;
}

/**
 * Recuts an already-loaded window at new percentiles.
 *
 * @param dataset - The window on screen.
 * @param floorPercentile - Fraction below which size reads as empty.
 * @param saturationPercentile - Fraction at which size reaches the hot end.
 * @returns The same window with both cuts moved.
 */
export function recutDataset(recut: DatasetRecutRequest): ChartDataset {
    const { dataset, viewport } = recut;
    const onScreen = viewport === undefined
        ? dataset.frames
        : dataset.frames.filter(
            (frame) => frame.capturedAtMs >= viewport.fromMs && frame.capturedAtMs <= viewport.toMs,
        );
    const measured = resolveDepthRange(
        sampleQuantities(onScreen.length === 0 ? dataset.frames : onScreen, dataset, viewport),
        recut.floorPercentile,
        recut.saturationPercentile,
    );

    return {
        ...dataset,
        floorQuantity: measured.floorQuantity,
        saturationQuantity: measured.saturationQuantity,
        revision: dataset.revision + 1,
    };
}

/**
 * Adds what has just traded to the bar still being built.
 *
 * Only the forming bar. A closed bar carries what the archive counted for it,
 * and a cluster arriving late for one of those would be counted twice.
 *
 * @param window - The bars on screen.
 * @param clusters - Executions that have just arrived.
 * @returns The window, with the forming bar's volume brought up to date.
 */
function absorbIntoFormingBar(
    window: PriceBarWindow,
    clusters: readonly TradeCluster[],
): PriceBarWindow {
    const forming = window.bars[window.bars.length - 1];
    if (forming === undefined || forming.isClosed) {
        return window;
    }

    let buyVolume = forming.buyVolume;
    let sellVolume = forming.sellVolume;
    let tradeCount = forming.tradeCount;
    let hasChanged = false;

    for (const cluster of clusters) {
        if (cluster.executedAtMs < forming.openedAtMs || cluster.executedAtMs >= forming.closedAtMs) {
            continue;
        }
        buyVolume += cluster.buyQuantity;
        sellVolume += cluster.sellQuantity;
        tradeCount += cluster.tradeCount;
        hasChanged = true;
    }

    if (!hasChanged) {
        return window;
    }

    return {
        ...window,
        bars: [...window.bars.slice(0, -1), { ...forming, buyVolume, sellVolume, tradeCount }],
    };
}
