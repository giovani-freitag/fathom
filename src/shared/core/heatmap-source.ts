import type { InstrumentCoverage } from './api-contract.ts';
import type { LiquidityFrameWindow } from './liquidity-frame.ts';
import type { RecordingGap } from './recording-gap.ts';
import type { PriceBarQuery, PriceBarWindow } from './price-bar.ts';
import type { TradeCluster } from './trade-cluster.ts';

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
/**
 * The four questions only this recording can answer.
 *
 * Not the bars. Candles are published by the venue for every past day and a
 * recording can only ever hold the days it ran for, so a bar comes from there
 * and the book comes from here — which is the whole reason this is its own
 * interface rather than a fifth method on the one below.
 */
export interface ArchiveSource {
    fetchInstruments(signal?: AbortSignal): Promise<readonly InstrumentCoverage[]>;
    fetchFrameWindow(query: FrameWindowQuery, signal?: AbortSignal): Promise<LiquidityFrameWindow>;
    fetchTradeClusters(query: TradeClusterQuery, signal?: AbortSignal): Promise<TradeClusterResult>;
    fetchGaps(query: FrameWindowQuery, signal?: AbortSignal): Promise<readonly RecordingGap[]>;
}

/** Everything the chart reads, the archive and the bars laid over it. */
export interface HeatmapSource extends ArchiveSource {
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
