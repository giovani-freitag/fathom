import type { LiquidityQueryService } from '../../../database/services/liquidity-query-service.ts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { refuseUnansweredWindow } from './window-guard.ts';
import type { WindowFilters } from '../schemas/window-schema.ts';

export interface GapsHandlerConfig {
    readonly query: LiquidityQueryService;
}

/**
 * Builds the recording gap handler.
 *
 * @param config - The read service backing the query.
 * @returns A handler listing unrecorded windows overlapping the range.
 */
export function createGapsHandler(config: GapsHandlerConfig) {
    return async function gapsHandler(
        request: FastifyRequest<{ Querystring: WindowFilters }>,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        const refused = refuseUnansweredWindow(request.query, reply);
        if (refused !== null) {
            return refused;
        }

        const gaps = await config.query.fetchGaps(request.query);
        return reply.send({ gaps });
    };
}
