import { encodeLiquidityFrameWindow } from '../../../shared/codec/heatmap-codec.ts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { refuseUnansweredWindow } from './window-guard.ts';
import type { ChunkArchiveService } from '../../../database/services/chunk-archive-service.ts';
import type { WindowFilters } from '../schemas/window-schema.ts';

export interface HeatmapHandlerConfig {
    /** The whole book as fixed squares, stacked in levels. */
    readonly chunks: ChunkArchiveService;
}

/**
 * Builds the depth window handler.
 *
 * The read is narrowed to the prices asked for rather than clipped after the
 * fact: the archive is stored in squares addressed by price and can skip the
 * ones outside the band, which saves the read as well as the wire.
 *
 * @param config - The archive backing the query.
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

        const window = await config.chunks.fetchWindow({
            instrumentSymbol: filters.symbol,
            fromMs: filters.fromMs,
            toMs: filters.toMs,
            maxColumns: filters.maxColumns,
            ...(filters.lowPrice === undefined ? {} : { lowPrice: filters.lowPrice }),
            ...(filters.highPrice === undefined ? {} : { highPrice: filters.highPrice }),
            ...(filters.maxRows === undefined ? {} : { maxRows: filters.maxRows }),
        });

        return reply
            .header('content-type', 'application/octet-stream')
            .header('cache-control', 'no-store')
            .send(Buffer.from(encodeLiquidityFrameWindow(window)));
    };
}
