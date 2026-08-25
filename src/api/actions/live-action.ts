import type { LiquidityQueryService } from '../../archive/liquidity-query-service.ts';
import type { FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { LiveSocketBridge } from '../live-socket-bridge.ts';
import type { LiveTailService } from '../live-tail-service.ts';
import type { LiveFilters } from '../schemas/live-schema.ts';

export interface LiveHandlerConfig {
    readonly liveTail: LiveTailService;
    readonly query: LiquidityQueryService;
}

/**
 * Builds the live tail socket handler.
 *
 * @param config - The tail service and the read service used to resolve the price grid.
 * @returns A websocket handler that streams new frames to one viewer.
 */
export function createLiveHandler(config: LiveHandlerConfig) {
    return async function liveHandler(
        socket: WebSocket,
        request: FastifyRequest<{ Querystring: LiveFilters }>,
    ): Promise<void> {
        const { symbol, afterMs } = request.query;

        const instruments = await config.query.listInstruments();
        const instrument = instruments.find((candidate) => candidate.instrumentSymbol === symbol);
        if (instrument === undefined) {
            socket.close(1008, `Instrument ${symbol} has never been recorded`);
            return;
        }

        new LiveSocketBridge({
            socket,
            liveTail: config.liveTail,
            instrumentSymbol: symbol,
            afterMs: afterMs === 0 ? Date.now() : afterMs,
            priceBucketSize: instrument.priceBucketSize,
        }).start();
    };
}
