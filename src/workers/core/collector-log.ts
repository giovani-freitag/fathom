import type { CollectorLogLevel } from '../../shared/core/collector-log-level.ts';

export type { CollectorLogLevel };

/** What a line carries besides its message, so it can be searched on. */
export type LogFields = Readonly<Record<string, string | number | boolean>>;

/**
 * Where a collector says what it is doing.
 */
export interface CollectorLog {
    info(message: string, fields?: LogFields): void;
    warning(message: string, fields?: LogFields): void;
    /**
     * A log that stamps every line it writes with the given fields.
     *
     * @param fields - What every line from the returned log carries.
     * @returns A log bound to those fields.
     */
    child(fields: LogFields): CollectorLog;
}

/**
 * Reads a message out of something thrown.
 *
 * @param error - Whatever a catch block received.
 * @returns The error's message, or its string form when it is not an Error.
 */
export function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Renders a line's fields for somewhere that can only hold a sentence.
 *
 * @param fields - What the line carries besides its message.
 * @returns The fields as text, empty when there are none.
 */
export function describeLogFields(fields?: LogFields): string {
    const entries = Object.entries(fields ?? {});
    if (entries.length === 0) {
        return '';
    }
    return ` ${entries.map(([name, value]) => `${name}=${String(value)}`).join(' ')}`;
}

/**
 * Formats one line for a reader rather than a query.
 *
 * @param level - Which stream the line belongs to.
 * @param message - What happened, in one line.
 * @param fields - What the line carries besides its message.
 * @returns The line, without a trailing newline.
 */
export function formatLogLine(
    level: CollectorLogLevel,
    message: string,
    fields?: LogFields,
): string {
    const label = level === 'info' ? 'INFO ' : 'WARN ';
    return `${new Date().toISOString()} ${label} ${message}${describeLogFields(fields)}`;
}
