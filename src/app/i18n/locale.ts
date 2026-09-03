// Held in the shared core rather than here: a reading a reader wrote names
// itself in these languages, and the surface it is written against may not
// reach into the app.
export { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from '../../shared/core/reading-words.ts';

import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from '../../shared/core/reading-words.ts';

/**
 * The supported language closest to what the reader asked for.
 *
 * @param requested - Language tags in descending order of preference.
 * @returns A supported locale, falling back to the default.
 */
export function resolveLocale(requested: readonly string[]): Locale {
    for (const tag of requested) {
        // Matched on the primary subtag so `pt`, `pt-PT` and `pt-BR` all land on
        // the one Portuguese translation rather than falling through to English.
        const primary = tag.toLowerCase().split('-')[0];
        const found = SUPPORTED_LOCALES.find(
            (locale) => locale.toLowerCase().split('-')[0] === primary,
        );
        if (found !== undefined) {
            return found;
        }
    }
    return DEFAULT_LOCALE;
}
