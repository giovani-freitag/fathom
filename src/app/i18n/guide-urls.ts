import type { Locale } from '../../shared/core/reading-words.ts';

/**
 * The guide, in the language the chart is being read in.
 *
 * Both languages sit under a folder of their own, so neither is the one a
 * reader gets by not asking — which means every link to it has to ask.
 */
export const GUIDE_URLS: Readonly<Record<Locale, string>> = {
    en: 'https://giovani-freitag.github.io/fathom/guide/en/writing-a-reading',
    'pt-BR': 'https://giovani-freitag.github.io/fathom/guide/pt-BR/writing-a-reading',
};

/**
 * The chapter on writing a connector, which is a different page.
 *
 * Separate because the two are different jobs and the indicator chapter says
 * nothing about a venue: pointing a reader who pressed "add a venue" at it
 * sends them somewhere that cannot answer the question they have.
 */
export const CONNECTOR_GUIDE_URLS: Readonly<Record<Locale, string>> = {
    en: 'https://giovani-freitag.github.io/fathom/guide/en/writing-a-connector',
    'pt-BR': 'https://giovani-freitag.github.io/fathom/guide/pt-BR/writing-a-connector',
};

/** The same guide, at its front page rather than at the chapter on writing one. */
export const GUIDE_HOME_URLS: Readonly<Record<Locale, string>> = {
    en: 'https://giovani-freitag.github.io/fathom/guide/en/',
    'pt-BR': 'https://giovani-freitag.github.io/fathom/guide/pt-BR/',
};
