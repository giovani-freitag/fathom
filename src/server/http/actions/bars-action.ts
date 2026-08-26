import type { BarFilters } from '../schemas/bars-schema.ts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LiquidityQueryService } from '../../../database/services/liquidity-query-service.ts';

export interface BarsHandlerConfig {
    readonly query: LiquidityQueryService;
}

/**
 * Builds the price bar handler.
 *
 * @param config - The read service backing the query.
 * @returns A handler answering with bars on the interval the caller declared.
 */
export function createBarsHandler(config: BarsHandlerConfig) {
    return async function barsHandler(
        request: FastifyRequest<{ Querystring: BarFilters }>,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        return reply.send(await config.query.fetchPriceBars(request.query));
    };
}
