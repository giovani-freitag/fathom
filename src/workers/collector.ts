import { CollectorSupervisor } from './collector-supervisor.ts';
import { openNodeCollectorLog } from './transport/node-collector-log.ts';
import { describeError } from './core/collector-log.ts';
import { LiquidityArchiveService } from '../database/services/liquidity-archive-service.ts';
import { PostgresChunkRowStore } from '../database/postgres/postgres-chunk-row-store.ts';
import { ChunkArchiveService } from '../database/services/chunk-archive-service.ts';
import { ChunkTileRecorder } from '../database/services/chunk-tile-recorder.ts';

import { RECORDING_CHANNEL } from '../database/core/recording-channel.ts';
import { openNodeMarketDataSocket } from './transport/node-market-data-socket.ts';
import { PostgresService } from '../database/postgres/postgres-service.ts';
import { readCollectorConfiguration, readDatabaseUrl, readLogFilePath } from './collector-environment.ts';
import { RecordingControlService } from '../database/services/recording-control-service.ts';
import { WHOLE_BOOK_FRAMING, WRITE_SETTINGS } from './core/collector-configuration.ts';

/** One writer per recorded contract, plus headroom for a retry and the control reads. */
const DATABASE_POOL_SIZE = 8;
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;
const DATABASE_CHANNEL_RETRY_DELAY_MS = 5_000;

/** How often the enabled set and the disk budget are re-read. */
const RECONCILE_INTERVAL_MS = 15_000;

/**
 * Silence after which a collector is replaced.
 *
 * Long enough for a book to resynchronise after a dropped stream, which is the
 * slowest thing a healthy runtime does.
 */
const STALL_TIMEOUT_MS = 120_000;

const { log, close: closeLog } = await openNodeCollectorLog({ filePath: readLogFilePath() });
const { instrumentSymbol, priceBucketSize, frameIntervalMs, ...shared } = readCollectorConfiguration();

const postgres = new PostgresService({
    connectionString: readDatabaseUrl(),
    maximumPoolSize: DATABASE_POOL_SIZE,
    statementTimeoutMs: DATABASE_STATEMENT_TIMEOUT_MS,
    channelRetryDelayMs: DATABASE_CHANNEL_RETRY_DELAY_MS,
});
const control = new RecordingControlService({ postgres });

// Fed from a framing of its own, because the recording the chart reads is
// clipped to a couple of percent before it is written.
const chunkRows = new PostgresChunkRowStore({ postgres });
const chunkTiles = new ChunkTileRecorder({
    archive: new ChunkArchiveService({ rows: chunkRows }),
    priceRangeRatio: WHOLE_BOOK_FRAMING.priceRangeRatio,
    intervalMs: WHOLE_BOOK_FRAMING.frameIntervalMs,
    stepRatio: 1 + WHOLE_BOOK_FRAMING.stepPrecision,
    onWriteFailed: (instrumentSymbol, reason) => {
        log.warning('A square of the book would not store', {
            instrumentSymbol,
            reason: describeError(reason),
        });
    },
    // Announced through the recorder itself, which is the one place that knows
    // a square landed. The gateway is listening, so a second reaches a reader
    // in the time it takes to store it rather than on their next interval.
    //
    // Deliberately unawaited and unreported: a reader that misses a nudge
    // catches up on its own, and a write must not be held up by the telling.
    onWritten: (instrumentSymbol) => {
        void postgres.notify(RECORDING_CHANNEL, instrumentSymbol).catch(() => undefined);
    },
});

const supervisor = new CollectorSupervisor({
    control,
    archive: new LiquidityArchiveService({ postgres, chunks: chunkRows }),
    buildWideRecordings: (instrumentSymbol, priceBucketSize) => [
        chunkTiles.buildRecording(instrumentSymbol, priceBucketSize),
    ],
    openSocket: openNodeMarketDataSocket,
    log,
    shared,
    framesPerFlush: WRITE_SETTINGS.framesPerFlush,
    reconcileIntervalMs: RECONCILE_INTERVAL_MS,
    stallTimeoutMs: STALL_TIMEOUT_MS,
    readNowMs: () => Date.now(),
});

async function shutDown(signalName: string): Promise<void> {
    log.warning('Received a stop signal, flushing before exit', { signalName });
    // Before the supervisor, not after: stopping it closes the pool underneath,
    // and a picture written onto a closed pool is a picture lost.
    await chunkTiles.flush();
    await supervisor.stop();
    await closeLog();
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
    log.info('Supervising the enabled contracts', { contracts: supervisor.recording.length });
} catch (error) {
    log.warning('The collector could not start', { reason: describeError(error) });
    await closeLog();
    process.exit(1);
}
