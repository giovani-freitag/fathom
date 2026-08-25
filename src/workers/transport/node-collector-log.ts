import type { CollectorLog } from '../core/collector-log.ts';
import { formatLogLine } from '../core/collector-log.ts';

/**
 * A log that writes to the process's own streams.
 *
 * @returns The log the runtime should be given in a Node registration.
 */
export function createNodeCollectorLog(): CollectorLog {
    return {
        info: (message) => { process.stdout.write(`${formatLogLine('info', message)}\n`); },
        warning: (message) => { process.stderr.write(`${formatLogLine('warning', message)}\n`); },
    };
}
