import type { InstrumentCoverage } from './api-contract.ts';
import type { LiquidityFrameWindow } from './liquidity-frame.ts';
import type { RecordingGap } from './recording-gap.ts';
import type { PriceBarQuery, PriceBarWindow } from './price-bar.ts';
import type { TradeCluster } from './trade-cluster.ts';

/**
 * The stored shape a window is read out of.
 *
 * The recording itself, and the chunked archive built from it. They answer the
 * same minutes in different shapes — one row per price the market stood at, and
 * fixed squares of the whole book stacked in levels — so a window drawn from
 * either can be held against the other, which is what has caught every fold
 * that drifted.
 */
export type FrameSource = 'frames' | 'chunks';

/** The stretch of price a window is asked to answer for, and the rows for it. */
export interface PriceBandQuery {
    readonly lowPrice: number;
    readonly highPrice: number;
    readonly maxRows: number;
}

export interface FrameWindowQuery {
    readonly symbol: string;
    readonly fromMs: number;
    readonly toMs: number;
    readonly maxColumns: number;
    /** Which stored shape the window is read out of. */
    readonly source?: FrameSource;
    /** The prices the reader will draw, or absent for every price stored. */
    readonly priceBand?: PriceBandQuery;
}

export interface TradeClusterQuery extends FrameWindowQuery {
    readonly priceGroupSize?: number;
    readonly minimumQuantity?: number;
}

export interface TradeClusterResult {
    readonly clusters: readonly TradeCluster[];
    readonly priceBucketSize: number;
    readonly sampleIntervalMs: number;
}

/**
 * Where the chart reads recorded history from.
 */
export interface HeatmapSource {
    fetchInstruments(signal?: AbortSignal): Promise<readonly InstrumentCoverage[]>;
    fetchFrameWindow(query: FrameWindowQuery, signal?: AbortSignal): Promise<LiquidityFrameWindow>;
    fetchTradeClusters(query: TradeClusterQuery, signal?: AbortSignal): Promise<TradeClusterResult>;
    fetchGaps(query: FrameWindowQuery, signal?: AbortSignal): Promise<readonly RecordingGap[]>;
    /**
     * Bars on a declared interval, with what built each one.
     *
     * Separate from the frame window on purpose: a frame window is sampled to
     * fit a surface, and a bar must not be.
     */
    fetchPriceBars(query: PriceBarQuery, signal?: AbortSignal): Promise<PriceBarWindow>;
}

/** Raised when a source cannot answer. `status` is 0 when nothing answered at all. */
export class HeatmapSourceError extends Error {
    readonly status: number;

    constructor(message: string, status: number, options?: ErrorOptions) {
        super(message, options);
        this.name = 'HeatmapSourceError';
        this.status = status;
    }
}
