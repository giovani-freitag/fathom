import { encodeLiquidityFrameWindow } from '../../../shared/codec/heatmap-codec.ts';
import type { LiquidityQueryService } from '../../../database/services/liquidity-query-service.ts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { refuseUnansweredWindow } from './window-guard.ts';
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
        const refused = refuseUnansweredWindow(filters, reply);
        if (refused !== null) {
            return refused;
        }

        const window = await config.query.fetchFrameWindow(filters);
        const encoded = encodeLiquidityFrameWindow(window);

        return reply
            .header('content-type', 'application/octet-stream')
            .header('cache-control', 'no-store')
            .send(Buffer.from(encoded));
    };
}
