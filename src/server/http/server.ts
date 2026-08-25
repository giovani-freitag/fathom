import compress from '@fastify/compress';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import websocket from '@fastify/websocket';
import { API_ROUTES } from '../../shared/core/api-contract.ts';
import type { LiquidityQueryService } from '../../database/services/liquidity-query-service.ts';
import type { PostgresService } from '../../database/core/postgres-service.ts';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveTailService } from '../services/live-tail-service.ts';
import { createGapsHandler } from './actions/gaps-action.ts';
import { createHealthHandler } from './actions/health-action.ts';
import { createHeatmapHandler } from './actions/heatmap-action.ts';
import { createInstrumentsHandler } from './actions/instruments-action.ts';
import { createLiveHandler } from './actions/live-action.ts';
import { createTradeClustersHandler } from './actions/trade-clusters-action.ts';
import { GapsRouteSchema } from './schemas/gaps-schema.ts';
import { HealthRouteSchema } from './schemas/health-schema.ts';
import { HeatmapRouteSchema } from './schemas/heatmap-schema.ts';
import { InstrumentsRouteSchema } from './schemas/instruments-schema.ts';
import { LiveRouteSchema } from './schemas/live-schema.ts';
import { TradeClustersRouteSchema } from './schemas/trade-clusters-schema.ts';

/** Depth windows reach a few megabytes before compression and almost all of it is zeros. */
const COMPRESSION_THRESHOLD_BYTES = 1_024;

export interface ServerConfig {
    readonly host: string;
    readonly port: number;
    readonly viewerDistPath: string;
    readonly postgres: PostgresService;
    readonly query: LiquidityQueryService;
    readonly liveTail: LiveTailService;
}

/**
 * HTTP and websocket surface over the recorded archive.
 *
 * Also serves the built viewer, so a phone on the same network reaches the whole
 * product at one address instead of needing a second origin and the CORS setup
 * that would come with it.
 */
export class Server {
    private readonly config: ServerConfig;
    private readonly app: FastifyInstance;

    constructor(config: ServerConfig) {
        this.config = config;
        this.registerApiRoutes = this.registerApiRoutes.bind(this);
        this.app = this.setupServer();
        this.setupRoutes();
    }

    /**
     * The underlying Fastify instance, for logging and tests.
     *
     * @returns The configured instance.
     */
    getApp(): FastifyInstance {
        return this.app;
    }

    /**
     * Binds the listening socket.
     *
     * @throws Error when the address is already in use.
     */
    async start(): Promise<void> {
        await this.app.listen({ host: this.config.host, port: this.config.port });
    }

    /**
     * Closes the listening socket and every live tail.
     */
    async stop(): Promise<void> {
        this.config.liveTail.stop();
        await this.app.close();
    }

    private setupServer(): FastifyInstance {
        const app = Fastify({ logger: { level: 'warn' } }).withTypeProvider<TypeBoxTypeProvider>();

        void app.register(cors, { origin: true });
        // The frame window is served as octet-stream, which mime-db marks as
        // incompressible; without this the largest response on the API is the one
        // that ships uncompressed.
        void app.register(compress, {
            threshold: COMPRESSION_THRESHOLD_BYTES,
            customTypes: /^application\/octet-stream$/,
        });
        void app.register(websocket);
        void app.register(swagger, {
            openapi: {
                info: { title: 'Fathom gateway', version: '0.1.0' },
            },
        });
        void app.register(swaggerUi, { routePrefix: '/api/docs' });

        this.registerViewerAssets(app);
        return app;
    }

    private registerViewerAssets(app: FastifyInstance): void {
        const viewerRoot = resolve(process.cwd(), this.config.viewerDistPath);
        if (!existsSync(viewerRoot)) {
            return;
        }
        // Wildcard rather than a route per file: the file-per-route mode indexes
        // the directory once at boot, so every viewer rebuild after that answers
        // 404 for its freshly hashed bundle until the gateway is restarted.
        void app.register(fastifyStatic, { root: viewerRoot, wildcard: true });
    }

    /**
     * Queues the API behind the plugins.
     *
     * Routes declared straight on the root instance are added before any
     * `register` call has loaded, so the compression plugin's `onRoute` hook
     * never sees them and the largest responses ship uncompressed. Registering
     * them as a plugin puts them in the same queue, after the others.
     */
    private setupRoutes(): void {
        void this.app.register(this.registerApiRoutes);
    }

    private registerApiRoutes(instance: FastifyInstance): void {
        const healthHandler = createHealthHandler({ postgres: this.config.postgres });
        const instrumentsHandler = createInstrumentsHandler({ query: this.config.query });
        const heatmapHandler = createHeatmapHandler({ query: this.config.query });
        const tradeClustersHandler = createTradeClustersHandler({ query: this.config.query });
        const gapsHandler = createGapsHandler({ query: this.config.query });
        const liveHandler = createLiveHandler({
            liveTail: this.config.liveTail,
            query: this.config.query,
        });

        instance.get(API_ROUTES.health, { schema: HealthRouteSchema }, healthHandler);
        instance.get(API_ROUTES.instruments, { schema: InstrumentsRouteSchema }, instrumentsHandler);
        instance.get(API_ROUTES.heatmap, { schema: HeatmapRouteSchema }, heatmapHandler);
        instance.get(API_ROUTES.tradeClusters, { schema: TradeClustersRouteSchema }, tradeClustersHandler);
        instance.get(API_ROUTES.gaps, { schema: GapsRouteSchema }, gapsHandler);
        instance.get(API_ROUTES.live, { websocket: true, schema: LiveRouteSchema }, liveHandler);
    }
}
