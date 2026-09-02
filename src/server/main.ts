import { LiquidityQueryService } from '../database/services/liquidity-query-service.ts';
import { RecordingControlService } from '../database/services/recording-control-service.ts';
import { PostgresService } from '../database/postgres/postgres-service.ts';
import { PostgresChunkRowStore } from '../database/postgres/postgres-chunk-row-store.ts';
import { ChunkArchiveService } from '../database/services/chunk-archive-service.ts';
import { StoredDepthTailSource } from '../shared/core/stored-depth-tail-source.ts';
import {
    LIVE_TAIL_SETTINGS,
    readGatewayConfiguration,
} from './core/gateway-configuration.ts';
import { Server } from './http/server.ts';
import { PostgresLiveTailSource } from './services/postgres-live-tail-source.ts';
import { RECORDING_CHANNEL } from '../database/core/recording-channel.ts';
import { LiveTailService } from './services/live-tail-service.ts';

const DATABASE_POOL_SIZE = 8;
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;
const DATABASE_CHANNEL_RETRY_DELAY_MS = 5_000;

const configuration = readGatewayConfiguration();

const postgres = new PostgresService({
    connectionString: configuration.databaseUrl,
    maximumPoolSize: DATABASE_POOL_SIZE,
    statementTimeoutMs: DATABASE_STATEMENT_TIMEOUT_MS,
    channelRetryDelayMs: DATABASE_CHANNEL_RETRY_DELAY_MS,
});
const query = new LiquidityQueryService({ postgres });
const chunks = new ChunkArchiveService({ rows: new PostgresChunkRowStore({ postgres }) });
const control = new RecordingControlService({ postgres });
const framesTail = new PostgresLiveTailSource({ query });
const readNowMs = () => Date.now();

/** A tail over one store, sharing the executions and holes nobody stores twice. */
const tailOver = (readWindow: ConstructorParameters<typeof StoredDepthTailSource>[0]['readWindow']) => (
    new StoredDepthTailSource({ readWindow, rest: framesTail, readNowMs })
);

const liveTail = new LiveTailService({
    source: framesTail,
    // One entry per store the reader can name: a chart drawn out of one store
    // and streamed out of another shows neither. Every name the route accepts
    // has to appear here.
    sourcesByName: {
        frames: framesTail,
        chunks: tailOver((request) => chunks.fetchWindow(request)),
    },
    pollIntervalMs: LIVE_TAIL_SETTINGS.pollIntervalMs,
    maxFramesPerPoll: LIVE_TAIL_SETTINGS.maxFramesPerPoll,
    maximumSubscriptions: LIVE_TAIL_SETTINGS.maximumSubscriptions,
});

const server = new Server({
    host: configuration.host,
    port: configuration.port,
    viewerDistPath: configuration.viewerDistPath,
    postgres,
    query,
    chunks,
    liveTail,
    control,
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
    // Followed before the first viewer arrives, so no tail is left waiting on
    // its own interval for a write that had already been announced.
    await postgres.listen(RECORDING_CHANNEL, (instrumentSymbol) => {
        liveTail.nudge(instrumentSymbol);
    });
    await server.start();
    process.stdout.write(`Fathom gateway listening on http://${configuration.host}:${configuration.port}\n`);
} catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${new Date().toISOString()} WARN  Could not start: ${reason}\n`);
    process.exit(1);
}
