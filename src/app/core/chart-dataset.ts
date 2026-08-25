import type { LiquidityFrame, LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';
import { resolveDepthRange } from '../painting/depth-colour-scale.ts';

/** Quantities inspected when picking the saturation point, at most. */
const SATURATION_SAMPLE_LIMIT = 40_000;

/** Where resting size stops brightening; above this the whole field washes out. */
const SATURATION_PERCENTILE = 0.995;

/**
 * Where resting size starts registering at all.
 *
 * Below this the field is the constant churn of quotes placed and pulled by the
 * second, which on a liquid perpetual is most of the book. Painting it spends
 * the ramp on noise and leaves a real wall competing with a lit background.
 */
const FLOOR_PERCENTILE = 0.40;

/**
 * How far the saturation point must move before it is adopted.
 *
 * Recomputed per window, the percentile drifts a few percent with every pan, and
 * every drift recolours the whole field. Holding it until the change is real is
 * what lets a wall keep its colour while the view moves across it.
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
     *
     * Held on the dataset rather than recomputed per paint so the renderer and
     * the legend agree, and so a streamed second cannot shift every colour on
     * screen by nudging a percentile.
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
        FLOOR_PERCENTILE,
        SATURATION_PERCENTILE,
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
 *
 * A wide window holds millions of quantities and the percentile only needs a
 * shape, so every nth value is taken rather than sorting the whole field.
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
 * Frames arriving live are already on the stored one-second grid, which is finer
 * than the sampled grid of a wide window. They are kept as they come and let the
 * renderer place them: several landing in one column simply means the last one
 * wins, which is the same rule the server's own sampling applies.
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
 * The live tail always bins on the stored price grid, while a wide window is
 * loaded on a coarser one. Arrivals are re-binned onto whatever grid the window
 * is using, otherwise a streamed bubble would be drawn at a price the rest of
 * the window does not use.
 *
 * @param dataset - The snapshot to extend.
 * @param clusters - Newly arrived clusters, on the stored price grid.
 * @returns The extended snapshot, or the original when nothing was new.
 */
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
