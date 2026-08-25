import type { RecordingGap } from '../recording/recording-gap.ts';
import type { TradeCluster } from '../trades/trade-cluster.ts';

export const API_ROUTES = {
    health: '/api/health',
    instruments: '/api/instruments',
    heatmap: '/api/heatmap',
    tradeClusters: '/api/trade-clusters',
    gaps: '/api/gaps',
    live: '/api/live',
} as const;

/**
 * Upper bound on frames per response.
 *
 * A heatmap column is at least one device pixel wide, so a window denser than
 * the widest plausible canvas costs bandwidth that no viewer can render.
 */
export const MAXIMUM_FRAMES_PER_WINDOW = 4_000;

export const DEFAULT_FRAMES_PER_WINDOW = 1_500;

/** Instrument descriptor, with the extent of what has actually been recorded. */
export interface InstrumentCoverage {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
    readonly firstFrameAtMs: number | null;
    readonly lastFrameAtMs: number | null;
}

export interface InstrumentListResponse {
    readonly instruments: readonly InstrumentCoverage[];
}

/** Time window shared by every history query. */
export interface WindowQuery {
    readonly symbol: string;
    readonly fromMs: number;
    readonly toMs: number;
    readonly maxColumns: number;
}

/**
 * Execution query, which bins price on top of the shared time window.
 *
 * `priceGroupSize` counts stored buckets per returned bucket, so the response
 * grid is `storedPriceBucketSize * priceGroupSize` tall.
 */
export interface TradeClusterQuery extends WindowQuery {
    readonly priceGroupSize: number;
    readonly minimumQuantity: number;
    readonly maxClusters: number;
}

export interface TradeClusterResponse {
    readonly priceBucketSize: number;
    readonly sampleIntervalMs: number;
    readonly clusters: readonly TradeCluster[];
}

export interface RecordingGapResponse {
    readonly gaps: readonly RecordingGap[];
}

export interface HealthResponse {
    readonly isDatabaseReachable: boolean;
    readonly serverTimeMs: number;
}

/**
 * Messages the live socket sends as text.
 *
 * Frames travel as binary on the same socket, in the frame window format, so a
 * receiver dispatches on the message type rather than on a discriminator field.
 */
export type LiveTextMessage =
    | { readonly kind: 'subscribed'; readonly instrumentSymbol: string; readonly priceBucketSize: number }
    | { readonly kind: 'trade-clusters'; readonly clusters: readonly TradeCluster[] }
    | { readonly kind: 'gap'; readonly gap: RecordingGap }
    | { readonly kind: 'stalled'; readonly lastFrameAtMs: number | null };
