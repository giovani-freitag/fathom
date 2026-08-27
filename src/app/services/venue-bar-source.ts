import type {
    FrameWindowQuery,
    HeatmapSource,
    TradeClusterQuery,
    TradeClusterResult,
} from '../../shared/core/heatmap-source.ts';
import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import type { LiquidityFrameWindow } from '../../shared/core/liquidity-frame.ts';
import type { PriceBarQuery, PriceBarWindow } from '../../shared/core/price-bar.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { VenueCandleService } from './venue-candle-service.ts';

export interface VenueBarSourceConfig {
    /** Where everything but the bars is read from. */
    readonly archive: HeatmapSource;
    readonly candles: VenueCandleService;
}

/**
 * The archive, with the candles taken from the venue instead.
 *
 * Wrapped rather than folded in, because only one of the five questions changes
 * answer: the book, the executions, the gaps and the coverage are all things
 * only this recording knows, and the price that moved through them is the one
 * thing any venue will hand over for every past day.
 *
 * One source for a candle and one for the book, never a choice between two. A
 * bar that came from the venue on a good day and from the recording on a bad one
 * would be a bar whose meaning depended on the network.
 */
export class VenueBarSource implements HeatmapSource {
    private readonly config: VenueBarSourceConfig;

    constructor(config: VenueBarSourceConfig) {
        this.config = config;
    }

    /**
     * Bars on a declared interval, from whichever source has them.
     *
     * @param query - The instrument, the range, the rung, and the warm-up.
     * @param signal - Aborts both the venue call and the archive's.
     * @returns The bars, oldest first.
     */
    async fetchPriceBars(query: PriceBarQuery, signal?: AbortSignal): Promise<PriceBarWindow> {
        return this.config.candles.fetchPriceBars(query, signal);
    }

    /**
     * The contracts this recording covers.
     *
     * @param signal - Aborts the call.
     * @returns What the archive holds.
     */
    async fetchInstruments(signal?: AbortSignal): Promise<readonly InstrumentCoverage[]> {
        return this.config.archive.fetchInstruments(signal);
    }

    /**
     * The book over a window.
     *
     * @param query - The instrument, the range, and the columns to fit.
     * @param signal - Aborts the call.
     * @returns What the archive holds.
     */
    async fetchFrameWindow(
        query: FrameWindowQuery,
        signal?: AbortSignal,
    ): Promise<LiquidityFrameWindow> {
        return this.config.archive.fetchFrameWindow(query, signal);
    }

    /**
     * What traded over a window, by price.
     *
     * @param query - The instrument, the range, and how to group it.
     * @param signal - Aborts the call.
     * @returns What the archive holds.
     */
    async fetchTradeClusters(
        query: TradeClusterQuery,
        signal?: AbortSignal,
    ): Promise<TradeClusterResult> {
        return this.config.archive.fetchTradeClusters(query, signal);
    }

    /**
     * The stretches nothing was recorded through.
     *
     * @param query - The instrument and the range.
     * @param signal - Aborts the call.
     * @returns What the archive holds.
     */
    async fetchGaps(query: FrameWindowQuery, signal?: AbortSignal): Promise<readonly RecordingGap[]> {
        return this.config.archive.fetchGaps(query, signal);
    }
}
