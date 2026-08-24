import type {
    LiquidityFrame,
    LiquidityFrameWindow,
    RecordingGap,
    TradeCluster,
} from '@fathom/contracts';
import { resolveSaturationQuantity } from '@core/domain/depth-colour-scale';

/** Quantities inspected when picking the saturation point, at most. */
const SATURATION_SAMPLE_LIMIT = 40_000;

/** Where resting size stops brightening; above this the whole field washes out. */
const SATURATION_PERCENTILE = 0.995;

/** Everything currently loaded for one instrument, as one immutable snapshot. */
export interface ChartDataset {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    /** Grid the window was sampled onto; live frames land on the same grid. */
    readonly sampleIntervalMs: number;
    readonly clusterPriceBucketSize: number;
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
    /** Increments on every change, so a renderer can cache against it. */
    readonly revision: number;
}

export const EMPTY_DATASET: ChartDataset = {
    instrumentSymbol: '',
    priceBucketSize: 1,
    sampleIntervalMs: 1_000,
    clusterPriceBucketSize: 1,
    frames: [],
    clusters: [],
    gaps: [],
    saturationQuantity: 1,
    revision: 0,
};

export interface DatasetReplaceRequest {
    readonly instrumentSymbol: string;
    readonly window: LiquidityFrameWindow;
    readonly clusters: readonly TradeCluster[];
    readonly clusterPriceBucketSize: number;
    readonly gaps: readonly RecordingGap[];
    readonly previousRevision: number;
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
        frames: request.window.frames,
        clusters: request.clusters,
        gaps: request.gaps,
        saturationQuantity: resolveSaturationQuantity(
            sampleQuantities(request.window.frames),
            SATURATION_PERCENTILE,
        ),
        revision: request.previousRevision + 1,
    };
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
 * @param dataset - The snapshot to extend.
 * @param clusters - Newly arrived clusters.
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
    const freshClusters = clusters.filter((cluster) => cluster.executedAtMs > newestLoadedMs);
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
