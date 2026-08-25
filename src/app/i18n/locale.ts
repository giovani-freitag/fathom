/** The languages the interface is written in. */
export type Locale = 'en' | 'pt-BR';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'pt-BR'];

export const DEFAULT_LOCALE: Locale = 'en';

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
