import { LiquidityQueryService } from '../database/services/liquidity-query-service.ts';
import { PostgresService } from '../database/core/postgres-service.ts';
import {
    LIVE_TAIL_SETTINGS,
    readGatewayConfiguration,
} from './core/gateway-configuration.ts';
import { Server } from './http/server.ts';
import { LiveTailService } from './services/live-tail-service.ts';

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
    maximumSubscriptions: LIVE_TAIL_SETTINGS.maximumSubscriptions,
});

const server = new Server({
    host: configuration.host,
    port: configuration.port,
    viewerDistPath: configuration.viewerDistPath,
    accessToken: configuration.accessToken,
    isTunnelled: configuration.isTunnelled,
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

// A supervisor restarts this process, so a failure to start is a retry rather
// than a crash. Saying so in one line beats a stack trace the log will repeat
// every five seconds until the database answers.
try {
    await postgres.connect();
    await server.start();
    process.stdout.write(`Fathom gateway listening on http://${configuration.host}:${configuration.port}\n`);
    process.stdout.write(server.isGuarded
        ? 'Access is guarded: only a link carrying the token gets in\n'
        : 'Access is OPEN: anyone who reaches this port sees everything\n');
} catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${new Date().toISOString()} WARN  Could not start: ${reason}\n`);
    process.exit(1);
}
