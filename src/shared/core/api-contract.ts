import type { RecordingGap } from './recording-gap.ts';
import type { TradeCluster } from './trade-cluster.ts';

/**
 * The widest window the archive will answer for.
 *
 * Declared with the routes because it is part of what they promise: a caller
 * that asks past it is refused, so a caller had better know where it is.
 */
export const MAXIMUM_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;

export const API_ROUTES = {
    health: '/api/health',
    instruments: '/api/instruments',
    heatmap: '/api/heatmap',
    bars: '/api/bars',
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

/**
 * Upper bound on price rows per response.
 *
 * Taller than any screen on purpose: the point is to hold back a whole-book
 * window that would otherwise answer with every price from nothing to twice the
 * market, not to second-guess how tall the reader's chart is.
 */
export const MAXIMUM_ROWS_PER_WINDOW = 4_000;

/** Instrument descriptor, with the extent of what has actually been recorded. */
export interface InstrumentCoverage {
    readonly instrumentSymbol: string;
    readonly priceBucketSize: number;
    readonly frameIntervalMs: number;
    readonly firstFrameAtMs: number | null;
    readonly lastFrameAtMs: number | null;
    /**
     * The price at the newest instant recorded, or null before the first.
     *
     * Carried here because a chart that does not know it has to read a whole
     * book to find out: measured, two seconds and a request that every other
     * one on the page queued behind, before anything was drawn.
     */
    readonly lastMidPrice: number | null;
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
