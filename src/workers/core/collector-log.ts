import type { CollectorLogLevel } from '../../shared/core/collector-log-level.ts';

export type { CollectorLogLevel };

/**
 * Where a collector says what it is doing.
 */
export interface CollectorLog {
    info(message: string): void;
    warning(message: string): void;
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
 * Formats one log line, so both registrations read the same in a transcript.
 *
 * @param level - Which stream the line belongs to.
 * @param message - What happened, in one line.
 * @returns The line, without a trailing newline.
 */
export function formatLogLine(level: CollectorLogLevel, message: string): string {
    const label = level === 'info' ? 'INFO ' : 'WARN ';
    return `${new Date().toISOString()} ${label} ${message}`;
}
