import type { LiquidityFrame, LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';
import { resolveDepthRange } from '../painting/depth-colour-scale.ts';

/** Quantities inspected when picking the saturation point, at most. */
const SATURATION_SAMPLE_LIMIT = 40_000;

/** Where resting size stops brightening; above this the whole field washes out. */
export const DEFAULT_SATURATION_PERCENTILE = 0.995;

/**
 * Where resting size starts registering at all.
 */
export const DEFAULT_FLOOR_PERCENTILE = 0.40;

/** Limits the two cuts are held inside, so neither can erase the other. */
export const DEPTH_CUT_RANGE = {
    floorMinimum: 0,
    floorMaximum: 0.9,
    floorStep: 0.01,
    saturationMinimum: 0.9,
    saturationMaximum: 1,
    // Half a percent, because the useful travel of the upper cut is the last
    // one percent: a whole step of it is the difference between reserving the
    // hot end for walls and handing it to a single outlier.
    saturationStep: 0.005,
} as const;

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
    readonly previousRevision: number;
    /** Floor the previous window was drawn with, held to stop a pan recolouring the field. */
    readonly previousFloorQuantity?: number;
    readonly floorPercentile: number;
    readonly saturationPercentile: number;
    /** Saturation already on screen, kept when the new window barely differs. */
    readonly previousSaturationQuantity?: number;
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
        sampleQuantities(request.window.frames),
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

/**
 * Reads a bounded, evenly spread sample of the resting sizes in a window.
 */
function sampleQuantities(frames: readonly LiquidityFrame[]): number[] {
    const totalQuantities = frames.reduce(
        (running, frame) => running + frame.bids.quantities.length + frame.asks.quantities.length,
        0,
    );
    const stride = Math.max(1, Math.ceil(totalQuantities / SATURATION_SAMPLE_LIMIT));

    const sampled: number[] = [];
    let cursor = 0;
    for (const frame of frames) {
        cursor = collectSide(frame.bids.quantities, stride, cursor, sampled);
        cursor = collectSide(frame.asks.quantities, stride, cursor, sampled);
    }
    return sampled;
}

function collectSide(
    quantities: Float32Array,
    stride: number,
    startCursor: number,
    sampled: number[],
): number {
    let cursor = startCursor;
    for (let offset = 0; offset < quantities.length; offset += 1) {
        if (cursor % stride === 0) {
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
export function appendClusters(
    dataset: ChartDataset,
    clusters: readonly TradeCluster[],
): ChartDataset {
    if (clusters.length === 0) {
        return dataset;
    }

    const newestLoadedMs = dataset.clusters[dataset.clusters.length - 1]?.executedAtMs ?? -Infinity;
    const groupSize = Math.max(1, Math.round(dataset.clusterPriceBucketSize / dataset.priceBucketSize));
    const freshClusters = clusters
        .filter((cluster) => cluster.executedAtMs > newestLoadedMs)
        .map((cluster) => (groupSize === 1
            ? cluster
            : { ...cluster, priceBucketIndex: Math.floor(cluster.priceBucketIndex / groupSize) }));

    if (freshClusters.length === 0) {
        return dataset;
    }

    return {
        ...dataset,
        clusters: [...dataset.clusters, ...freshClusters],
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
export function recutDataset(
    dataset: ChartDataset,
    floorPercentile: number,
    saturationPercentile: number,
): ChartDataset {
    const measured = resolveDepthRange(
        sampleQuantities(dataset.frames),
        floorPercentile,
        saturationPercentile,
    );

    return {
        ...dataset,
        floorQuantity: measured.floorQuantity,
        saturationQuantity: measured.saturationQuantity,
        revision: dataset.revision + 1,
    };
}
