import { CollectorRuntime } from './collector-runtime.ts';
import { LiquidityArchiveService } from '../database/services/liquidity-archive-service.ts';
import { PostgresService } from '../database/postgres/postgres-service.ts';
import { WRITE_SETTINGS } from './core/collector-configuration.ts';
import { openNodeMarketDataSocket } from './transport/node-market-data-socket.ts';
import { readCollectorConfiguration } from './core/collector-configuration.ts';
import { describeError, logWarning } from './core/collector-log.ts';

/** Connections the collector opens: one writer plus headroom for a retry. */
const DATABASE_POOL_SIZE = 4;
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;

const configuration = readCollectorConfiguration();
const postgres = new PostgresService({
    connectionString: configuration.databaseUrl,
    maximumPoolSize: DATABASE_POOL_SIZE,
    statementTimeoutMs: DATABASE_STATEMENT_TIMEOUT_MS,
});

const runtime = new CollectorRuntime({
    configuration,
    openSocket: openNodeMarketDataSocket,
    archive: new LiquidityArchiveService({ postgres }),
    framesPerFlush: WRITE_SETTINGS.framesPerFlush,
});

async function shutDown(signalName: string): Promise<void> {
    logWarning(`Received ${signalName}, flushing before exit`);
    await runtime.stop();
    process.exit(0);
}

process.on('SIGINT', () => void shutDown('SIGINT'));
process.on('SIGTERM', () => void shutDown('SIGTERM'));

// A supervisor restarts this process, so a failure to start is a retry rather
// than a crash. Saying so in one line beats a stack trace the log will repeat
// every five seconds until the database answers.
try {
    await runtime.start();
} catch (error) {
    logWarning(`Could not start: ${describeError(error)}`);
    process.exit(1);
}
