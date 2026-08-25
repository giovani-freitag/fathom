import type { InstrumentCoverage } from './api-contract.ts';
import type { LiquidityFrameWindow } from './liquidity-frame.ts';
import type { RecordingGap } from './recording-gap.ts';
import type { TradeCluster } from './trade-cluster.ts';

export interface FrameWindowQuery {
    readonly symbol: string;
    readonly fromMs: number;
    readonly toMs: number;
    readonly maxColumns: number;
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
 *
 * Named for what it provides rather than how it is reached, because the same
 * chart is served two ways: over HTTP from a gateway that queries PostgreSQL,
 * and directly out of the browser's own archive when the page is recording for
 * itself. Neither the controller nor any painter can tell which it has.
 */
export interface HeatmapSource {
    fetchInstruments(signal?: AbortSignal): Promise<readonly InstrumentCoverage[]>;
    fetchFrameWindow(query: FrameWindowQuery, signal?: AbortSignal): Promise<LiquidityFrameWindow>;
    fetchTradeClusters(query: TradeClusterQuery, signal?: AbortSignal): Promise<TradeClusterResult>;
    fetchGaps(query: FrameWindowQuery, signal?: AbortSignal): Promise<readonly RecordingGap[]>;
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
