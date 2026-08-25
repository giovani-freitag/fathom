import { HeatmapApiError } from '../services/heatmap-api-service.ts';
import type { TranslationKey } from '../i18n/dictionaries/en.ts';

/**
 * Names a load failure in terms the interface can put on screen.
 *
 * @param error - Whatever the load rejected with.
 * @returns The phrase to render, never the underlying message.
 */
export function resolveFailureKey(error: unknown): TranslationKey {
    if (error instanceof HeatmapApiError) {
        if (error.status === 0) {
            return 'failure.silent';
        }
        if (error.status >= 500) {
            return 'failure.server';
        }
        if (error.status >= 400) {
            return 'failure.refused';
        }
    }
    return 'failure.generic';
}
