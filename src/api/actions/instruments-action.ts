import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LiquidityQueryService } from '../../archive/liquidity-query-service.ts';

export interface InstrumentsHandlerConfig {
    readonly query: LiquidityQueryService;
}

/**
 * Builds the instrument listing handler.
 *
 * @param config - The read service backing the listing.
 * @returns A handler returning every recorded instrument and its extent.
 */
export function createInstrumentsHandler(config: InstrumentsHandlerConfig) {
    return async function instrumentsHandler(
        _request: FastifyRequest,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        const instruments = await config.query.listInstruments();
        return reply.send({ instruments });
    };
}
