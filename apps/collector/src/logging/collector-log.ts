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
