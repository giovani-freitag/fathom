import { CollectorRuntime } from './collector-runtime.ts';
import { readCollectorConfiguration } from './core/collector-configuration.ts';
import { describeError, logWarning } from './core/collector-log.ts';

const runtime = new CollectorRuntime(readCollectorConfiguration());

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
