import type { RecordingGap } from './recording-gap.ts';
import type { TradeCluster } from './trade-cluster.ts';

export const API_ROUTES = {
    health: '/api/health',
    instruments: '/api/instruments',
    heatmap: '/api/heatmap',
    tradeClusters: '/api/trade-clusters',
    gaps: '/api/gaps',
    live: '/api/live',
    recording: '/api/recording',
    recordingBudget: '/api/recording/budget',
} as const;

/**
 * Upper bound on frames per response.
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
 */
