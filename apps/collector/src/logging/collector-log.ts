/**
 * Writes an operational line to standard output.
 *
 * @param message - What happened, in one line.
 */
export function logInfo(message: string): void {
    process.stdout.write(`${new Date().toISOString()} INFO  ${message}\n`);
}

/**
 * Writes a line about something that degraded the recording.
 *
 * @param message - What went wrong, in one line.
 */
export function logWarning(message: string): void {
    process.stderr.write(`${new Date().toISOString()} WARN  ${message}\n`);
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
