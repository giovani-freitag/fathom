import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PostgresService } from '../../../database/core/postgres-service.ts';

export interface HealthHandlerConfig {
    readonly postgres: PostgresService;
}

/**
 * Builds the readiness handler.
 *
 * @param config - The database service to probe.
 * @returns A handler reporting whether the archive answers.
 */
export function createHealthHandler(config: HealthHandlerConfig) {
    return async function healthHandler(
        _request: FastifyRequest,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        let isDatabaseReachable = true;
        try {
            await config.postgres.selectRows('SELECT 1');
        } catch {
            isDatabaseReachable = false;
        }

        return reply.send({ isDatabaseReachable, serverTimeMs: Date.now() });
    };
}
