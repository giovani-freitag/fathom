import { CollectorSupervisor } from './collector-supervisor.ts';
import { createNodeCollectorLog } from './transport/node-collector-log.ts';
import { describeError } from './core/collector-log.ts';
import { LiquidityArchiveService } from '../database/services/liquidity-archive-service.ts';
import { openNodeMarketDataSocket } from './transport/node-market-data-socket.ts';
import { PostgresService } from '../database/postgres/postgres-service.ts';
import { readCollectorConfiguration, readDatabaseUrl } from './collector-environment.ts';
import { RecordingControlService } from '../database/services/recording-control-service.ts';
import { WRITE_SETTINGS } from './core/collector-configuration.ts';

/** One writer per recorded contract, plus headroom for a retry and the control reads. */
const DATABASE_POOL_SIZE = 8;
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;

/** How often the enabled set and the disk budget are re-read. */
const RECONCILE_INTERVAL_MS = 15_000;

const log = createNodeCollectorLog();
const { instrumentSymbol, priceBucketSize, frameIntervalMs, ...shared } = readCollectorConfiguration();

const postgres = new PostgresService({
    connectionString: readDatabaseUrl(),
    maximumPoolSize: DATABASE_POOL_SIZE,
    statementTimeoutMs: DATABASE_STATEMENT_TIMEOUT_MS,
});
const control = new RecordingControlService({ postgres });

const supervisor = new CollectorSupervisor({
    control,
    archive: new LiquidityArchiveService({ postgres }),
    openSocket: openNodeMarketDataSocket,
    log,
    shared,
    framesPerFlush: WRITE_SETTINGS.framesPerFlush,
    reconcileIntervalMs: RECONCILE_INTERVAL_MS,
});

async function shutDown(signalName: string): Promise<void> {
    log.warning(`Received ${signalName}, flushing before exit`);
    await supervisor.stop();
    process.exit(0);
}

process.on('SIGINT', () => void shutDown('SIGINT'));
process.on('SIGTERM', () => void shutDown('SIGTERM'));

// A service manager restarts this process, so a failure to start is a retry
// rather than a crash. Saying so in one line beats a stack trace the log will
// repeat every five seconds until the database answers.
try {
    // The entry owns the pool, so it opens it: the seed below and the
    // supervisor's first reconcile both read through it, and neither can be the
    // one that connects without the other having to know the order.
    await postgres.connect();

    // The environment still names one contract: it is the seed a fresh database
    // needs, so a first run records something without anyone opening the chart.
    await control.saveContract({
        instrumentSymbol,
        priceBucketSize,
        frameIntervalMs,
        isEnabled: true,
    });
    await supervisor.start();
    log.info(`Supervising ${supervisor.recording.length} contract(s)`);
} catch (error) {
    log.warning(`Could not start: ${describeError(error)}`);
    process.exit(1);
}
