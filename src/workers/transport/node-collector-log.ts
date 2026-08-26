import type { CollectorLog, CollectorLogLevel } from '../core/collector-log.ts';
import buildRollingFile from 'pino-roll';
import { type Logger, pino } from 'pino';

// Files are named `collector.<date>.<roll>.log` and hold one JSON object per
// line. The extension stays `.log` because pino-roll 4 ignores the option that
// would change it, and a `.log` full of JSON is what pino writes everywhere.
/** Days of history kept beside today's file. */
const RETAINED_DAYS = 14;

/** Size at which a day rolls early, so one bad hour cannot fill a disk. */
const MAXIMUM_FILE_SIZE = '64m';

export interface NodeCollectorLogConfig {
    /** Path the dated suffix is appended to, such as `logs/collector`. */
    readonly filePath: string;
}

export interface OpenedCollectorLog {
    readonly log: CollectorLog;
    /**
     * Drains everything written so far to the disk and closes the file.
     *
     * Nothing may be logged afterwards. Lines are buffered on their way out, so
     * a process that exits without this loses whatever it said last — which is
     * the part worth reading.
     */
    close(): Promise<void>;
}

/**
 * Opens a log that writes one JSON line per event, into a file per day.
 *
 * @param config - Where the dated files are written.
 * @returns The log the runtime should be given in a Node registration.
 * @throws Error when the directory cannot be opened for writing.
 */
export async function openNodeCollectorLog(
    config: NodeCollectorLogConfig,
): Promise<OpenedCollectorLog> {
    const destination = await buildRollingFile({
        file: config.filePath,
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        size: MAXIMUM_FILE_SIZE,
        limit: { count: RETAINED_DAYS, removeOtherLogFiles: true },
        mkdir: true,
    });

    const logger = pino({
        // Renamed from pino's defaults so a line reads the same whether it came
        // from here or from the gateway, which logs through the same library.
        base: null,
        messageKey: 'message',
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: { level: (label: string) => ({ level: toLevel(label) }) },
    }, destination);

    return {
        log: wrap(logger),
        // Closed rather than flushed: the stream reports a flush the moment it
        // has handed the bytes on, which is before they have reached the disk,
        // and `flushSync` refuses until the file has finished opening. Waiting
        // for the close is the only point at which the last line is safe.
        close: async () => {
            await new Promise<void>((resolve) => { logger.flush(() => { resolve(); }); });
            await new Promise<void>((resolve) => {
                destination.once('close', resolve);
                destination.end();
            });
        },
    };
}

/**
 * Presents a pino logger as the port, so no caller names the library.
 */
function wrap(logger: Logger): CollectorLog {
    return {
        info: (message, fields) => { logger.info(fields ?? {}, message); },
        warning: (message, fields) => { logger.warn(fields ?? {}, message); },
        child: (fields) => wrap(logger.child(fields)),
    };
}

function toLevel(label: string): CollectorLogLevel {
    return label === 'info' ? 'info' : 'warning';
}
