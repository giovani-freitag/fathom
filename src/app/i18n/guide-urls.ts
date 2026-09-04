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

/** The same guide, at its front page rather than at the chapter on writing one. */
export const GUIDE_HOME_URLS: Readonly<Record<Locale, string>> = {
    en: 'https://giovani-freitag.github.io/fathom/guide/en/',
    'pt-BR': 'https://giovani-freitag.github.io/fathom/guide/pt-BR/',
};
