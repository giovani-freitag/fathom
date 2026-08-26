import type { CollectorLog, CollectorLogLevel, LogFields } from '../../src/workers/core/collector-log.ts';

export interface RecordedLogLine {
    readonly level: CollectorLogLevel;
    readonly message: string;
    /** The bound fields of the log that wrote it, merged with the call's own. */
    readonly fields: LogFields;
}

export interface MockCollectorLog {
    readonly log: CollectorLog;
    readonly lines: RecordedLogLine[];
    linesAbout: (instrumentSymbol: string) => RecordedLogLine[];
}

/**
 * A log that keeps what it was told, with the fields each line carried.
 *
 * @returns The log to hand a collector, and the lines it recorded.
 */
export function createMockCollectorLog(): MockCollectorLog {
    const lines: RecordedLogLine[] = [];

    return {
        log: build(lines, {}),
        lines,
        linesAbout: (instrumentSymbol) => lines.filter(
            (line) => line.fields['instrumentSymbol'] === instrumentSymbol,
        ),
    };
}

function build(lines: RecordedLogLine[], bound: LogFields): CollectorLog {
    return {
        info: (message, fields) => {
            lines.push({ level: 'info', message, fields: { ...bound, ...fields } });
        },
        warning: (message, fields) => {
            lines.push({ level: 'warning', message, fields: { ...bound, ...fields } });
        },
        child: (fields) => build(lines, { ...bound, ...fields }),
    };
}
