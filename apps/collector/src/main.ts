import { CollectorRuntime } from './collector-runtime.ts';
import { readCollectorConfiguration } from './configuration/collector-configuration.ts';
import { logWarning } from './logging/collector-log.ts';

const runtime = new CollectorRuntime(readCollectorConfiguration());

async function shutDown(signalName: string): Promise<void> {
    logWarning(`Received ${signalName}, flushing before exit`);
    await runtime.stop();
    process.exit(0);
}

process.on('SIGINT', () => void shutDown('SIGINT'));
process.on('SIGTERM', () => void shutDown('SIGTERM'));

await runtime.start();
