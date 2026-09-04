/** The languages the interface is written in. */
export type Locale = 'en' | 'pt-BR';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'pt-BR'];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * The same phrase in as many languages as its author wrote it in.
 *
 * English is required rather than optional: a phrase has to have something to
 * fall back to, and a fallback picked at random from whatever was supplied is
 * a phrase nobody chose.
 */
export type Words = { readonly en: string } & Partial<Record<Locale, string>>;

let spoken: Locale = DEFAULT_LOCALE;

/**
 * Sets the language readings answer in.
 *
 * The host's, not a reading's: a reading says what it is called, and the page
 * says which language it is being read in.
 *
 * @param locale - The language the interface is now in.
 */
export function speakIn(locale: Locale): void {
    spoken = locale;
}

/**
 * One phrase in the language the page is being read in.
 *
 * @param words - The phrase, in every language its author wrote it in.
 * @returns The reader's language where the author supplied it, English otherwise.
 */
export function inWords(words: Words): string {
    return words[spoken] ?? words.en;
}
