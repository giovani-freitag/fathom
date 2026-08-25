import type { LiquidityQueryService } from '../../../database/services/liquidity-query-service.ts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { QUERY_LIMITS } from '../../core/gateway-configuration.ts';
import type { TradeClustersFilters } from '../schemas/trade-clusters-schema.ts';

export interface TradeClustersHandlerConfig {
    readonly query: LiquidityQueryService;
}

/**
 * Builds the execution binning handler.
 *
 * @param config - The read service backing the query.
 * @returns A handler answering with clusters on the requested time and price grid.
 */
export function createTradeClustersHandler(config: TradeClustersHandlerConfig) {
    return async function tradeClustersHandler(
        request: FastifyRequest<{ Querystring: TradeClustersFilters }>,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        const filters = request.query;
        if (filters.toMs <= filters.fromMs) {
            return reply.code(400).send({ error: 'InvalidRange', message: 'toMs must be greater than fromMs' });
        }

        const window = await config.query.fetchTradeClusters({
            ...filters,
            maxClusters: QUERY_LIMITS.maximumClusters,
        });

        return reply.send(window);
    };
}
