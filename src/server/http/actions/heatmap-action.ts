import type { FrameSource } from '../../../shared/core/heatmap-source.ts';
import { bandReadWindow } from '../../../shared/core/frame-fold.ts';
import { encodeLiquidityFrameWindow } from '../../../shared/codec/heatmap-codec.ts';
import type { LiquidityQueryService } from '../../../database/services/liquidity-query-service.ts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LiquidityFrameWindow } from '../../../shared/core/liquidity-frame.ts';
import { refuseUnansweredWindow } from './window-guard.ts';
import type { ChunkArchiveService } from '../../../database/services/chunk-archive-service.ts';
import type { WindowFilters } from '../schemas/window-schema.ts';

export interface HeatmapHandlerConfig {
    readonly query: LiquidityQueryService;
    /** The whole book as fixed squares, stacked in levels. */
    readonly chunks: ChunkArchiveService;
}

interface HeatmapFilters extends WindowFilters {
    readonly source?: FrameSource;
}

/**
 * Where one window comes from, whichever store the reader named.
 *
 * The chunked archive narrows the read to the prices asked for, because it is
 * stored in squares addressed by price and can skip the ones outside them. The
 * frame table cannot: it reads its stored rows whatever the reader asked for,
 * so the band is applied to what it answered. That saves nothing on the read
 * and everything on the wire, which is where the cost was.
 */
async function readWindow(
    config: HeatmapHandlerConfig,
    filters: HeatmapFilters,
): Promise<LiquidityFrameWindow> {
    if (filters.source === 'chunks') {
        return config.chunks.fetchWindow({
            instrumentSymbol: filters.symbol,
            fromMs: filters.fromMs,
            toMs: filters.toMs,
            maxColumns: filters.maxColumns,
            ...(filters.lowPrice === undefined ? {} : { lowPrice: filters.lowPrice }),
            ...(filters.highPrice === undefined ? {} : { highPrice: filters.highPrice }),
            ...(filters.maxRows === undefined ? {} : { maxRows: filters.maxRows }),
        });
    }

    return bandReadWindow(await config.query.fetchFrameWindow(filters), filters);
}

/**
 * Builds the depth window handler.
 *
 * @param config - The read service backing the query.
 * @returns A handler answering with an encoded binary frame window.
 */
export function createHeatmapHandler(config: HeatmapHandlerConfig) {
    return async function heatmapHandler(
        request: FastifyRequest<{ Querystring: HeatmapFilters }>,
        reply: FastifyReply,
    ): Promise<FastifyReply> {
        const filters = request.query;
        const refused = refuseUnansweredWindow(filters, reply);
        if (refused !== null) {
            return refused;
        }

        const window = await readWindow(config, filters);
        const encoded = encodeLiquidityFrameWindow(window);

        return reply
            .header('content-type', 'application/octet-stream')
            .header('cache-control', 'no-store')
            .send(Buffer.from(encoded));
    };
}
