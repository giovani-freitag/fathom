import { HeatmapApiError } from '../services/heatmap-api-service.ts';

/**
 * Turns a load failure into something worth putting on screen.
 *
 * A driver's own message is written for whoever is reading a stack trace, in
 * whatever language the library was written in. What a reader needs is which
 * side broke and whether waiting will help.
 *
 * @param error - Whatever the load rejected with.
 * @returns One sentence, in the interface's language.
 */
export function describeLoadFailure(error: unknown): string {
    if (error instanceof HeatmapApiError) {
        if (error.status === 0) {
            return 'The gateway did not answer. Check that it is running.';
        }
        if (error.status >= 500) {
            return 'The gateway failed to answer. The archive may be unreachable.';
        }
        if (error.status >= 400) {
            return 'The gateway refused the query.';
        }
    }
    return 'Could not load the window.';
}
