import type { BetweenRequest, TailCompanions } from '../../shared/core/live-tail.ts';
import type { LiquidityQueryService } from '../../database/services/liquidity-query-service.ts';
import type { RecordingGap } from '../../shared/core/recording-gap.ts';
import type { TradeCluster } from '../../shared/core/trade-cluster.ts';

/** Prints a single pass will carry, so a long stall is not one flood. */
const MAXIMUM_CLUSTERS = 5_000;

export interface PostgresLiveTailSourceConfig {
    readonly query: LiquidityQueryService;
}

/**
 * What a tail needs beyond depth, answered from the tables that keep it.
 *
 * Neither the executions nor the holes are kept per store — there is one of
 * each — so a tail over any archive takes them from here and takes only the
 * depth from the archive itself.
 */
export class PostgresLiveTailSource implements TailCompanions {
    private readonly query: LiquidityQueryService;

    constructor(config: PostgresLiveTailSourceConfig) {
        this.query = config.query;
    }

    /**
     * Executions in a half-open range, on the recorded grid.
     *
     * @param request - The instrument and the range.
     * @returns The clusters, ungrouped.
     */
    async fetchTradeClustersBetween(request: BetweenRequest): Promise<readonly TradeCluster[]> {
        const window = await this.query.fetchTradeClusters({
            ...request,
            maxColumns: MAXIMUM_CLUSTERS,
            priceGroupSize: 1,
            minimumQuantity: 0,
            maxClusters: MAXIMUM_CLUSTERS,
        });
        return window.clusters;
    }

    /**
     * Stretches in a half-open range that went unrecorded.
     *
     * @param request - The instrument and the range.
     * @returns The gaps overlapping it.
     */
    fetchGapsBetween(request: BetweenRequest): Promise<readonly RecordingGap[]> {
        return this.query.fetchGaps({ ...request, maxColumns: MAXIMUM_CLUSTERS });
    }
}
