import { LiquidityQueryService, PostgresService } from '@fathom/persistence';
import {
    LIVE_TAIL_SETTINGS,
    readGatewayConfiguration,
} from './configuration/gateway-configuration.ts';
import { Server } from './server/server.ts';
import { LiveTailService } from './services/live-tail/live-tail-service.ts';

const DATABASE_POOL_SIZE = 8;
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;

const configuration = readGatewayConfiguration();

const postgres = new PostgresService({
    connectionString: configuration.databaseUrl,
    maximumPoolSize: DATABASE_POOL_SIZE,
    statementTimeoutMs: DATABASE_STATEMENT_TIMEOUT_MS,
});
const query = new LiquidityQueryService({ postgres });
const liveTail = new LiveTailService({
    query,
    pollIntervalMs: LIVE_TAIL_SETTINGS.pollIntervalMs,
    maxFramesPerPoll: LIVE_TAIL_SETTINGS.maxFramesPerPoll,
});

const server = new Server({
    host: configuration.host,
    port: configuration.port,
    viewerDistPath: configuration.viewerDistPath,
    postgres,
    query,
    liveTail,
});

async function shutDown(): Promise<void> {
    await server.stop();
    await postgres.close();
    process.exit(0);
}

process.on('SIGINT', () => void shutDown());
process.on('SIGTERM', () => void shutDown());

await postgres.connect();
await server.start();
process.stdout.write(`Fathom gateway listening on http://${configuration.host}:${configuration.port}\n`);
