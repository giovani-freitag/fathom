import type { InstrumentCoverage } from '../../../shared/core/api-contract.ts';
import type { LiquidityQueryService } from '../../../database/services/liquidity-query-service.ts';
import type { FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { LiveSocketBridge } from '../../services/live-socket-bridge.ts';
import type { LiveTailService } from '../../services/live-tail-service.ts';
import type { LiveFilters } from '../schemas/live-schema.ts';

/** Close code for a refusal no retry will fix. */
const SOCKET_POLICY_VIOLATION = 1008;

/** Close code for a failure on this side, which a viewer retries after. */
const SOCKET_INTERNAL_ERROR = 1011;

/** What the websocket route registers. */
type LiveHandler = (
    socket: WebSocket,
    request: FastifyRequest<{ Querystring: LiveFilters }>,
) => Promise<void>;

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
export function createLiveHandler(config: LiveHandlerConfig): LiveHandler {
    return async function liveHandler(
        socket: WebSocket,
        request: FastifyRequest<{ Querystring: LiveFilters }>,
    ): Promise<void> {
        const { symbol, afterMs } = request.query;

        let instruments: readonly InstrumentCoverage[];
        try {
            instruments = await config.query.listInstruments();
        } catch {
            // Left open, the viewer holds a socket that never sends and never
            // closes, so the feed reads as streaming while nothing arrives.
            socket.close(SOCKET_INTERNAL_ERROR, 'Could not read what is recorded');
            return;
        }

        const instrument = instruments.find((candidate) => candidate.instrumentSymbol === symbol);
        if (instrument === undefined) {
            socket.close(SOCKET_POLICY_VIOLATION, `Instrument ${symbol} has never been recorded`);
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
