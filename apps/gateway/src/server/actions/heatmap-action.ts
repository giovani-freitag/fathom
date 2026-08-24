import { encodeLiquidityFrameWindow } from '@fathom/contracts';
import type { LiquidityQueryService } from '@fathom/persistence';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { QUERY_LIMITS } from '../../configuration/gateway-configuration.ts';
import type { WindowFilters } from '../schemas/window-schema.ts';

export interface HeatmapHandlerConfig {
    readonly query: LiquidityQueryService;
}

/**
 * Builds the depth window handler.
 *
 * @param config - The read service backing the query.
 * @returns A handler answering with an encoded binary frame window.
 */
export function createHeatmapHandler(config: HeatmapHandlerConfig) {
    return async function heatmapHandler(
        request: FastifyRequest<{ Querystring: WindowFilters }>,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        const filters = request.query;
        if (filters.toMs <= filters.fromMs) {
            return reply.code(400).send({ error: 'InvalidRange', message: 'toMs must be greater than fromMs' });
        }
        if (filters.toMs - filters.fromMs > QUERY_LIMITS.maximumRangeMs) {
            return reply.code(400).send({
                error: 'RangeTooWide',
                message: `Range must not exceed ${QUERY_LIMITS.maximumRangeMs}ms`,
            });
        }

        const window = await config.query.fetchFrameWindow(filters);
        const encoded = encodeLiquidityFrameWindow(window);

        return reply
            .header('content-type', 'application/octet-stream')
            .header('cache-control', 'no-store')
            .send(Buffer.from(encoded));
    };
}
