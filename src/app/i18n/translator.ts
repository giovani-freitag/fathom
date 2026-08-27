import { type Dictionary, EN_DICTIONARY, type TranslationKey } from './dictionaries/en.ts';
import type { Locale } from './locale.ts';
import { PT_BR_DICTIONARY } from './dictionaries/pt-br.ts';

const DICTIONARIES: Record<Locale, Dictionary> = {
    'en': EN_DICTIONARY,
    'pt-BR': PT_BR_DICTIONARY,
};

/** Values substituted into a phrase's `{placeholder}` slots. */
export type TranslationValues = Readonly<Record<string, string | number>>;

/** Renders one phrase in the reader's language. */
export type Translate = (key: TranslationKey, values?: TranslationValues) => string;

const RENDERERS = new Map<Locale, Translate>();

/**
 * The phrase renderer for a language.
 *
 * @param locale - The language to render in.
 * @returns A renderer bound to that language's copy, the same one every time.
 */
export function buildTranslate(locale: Locale): Translate {
    // One renderer per language rather than one per call: the canvas caches a
    // layer against what it was drawn from, and a fresh closure on every paint
    // would read as a language change and throw the cache away every frame.
    let renderer = RENDERERS.get(locale);
    if (renderer === undefined) {
        const dictionary = DICTIONARIES[locale];
        renderer = (key, values) => interpolate(dictionary[key], values);
        RENDERERS.set(locale, renderer);
    }
    return renderer;
}

function interpolate(phrase: string, values?: TranslationValues): string {
    if (values === undefined) {
        return phrase;
    }
    return phrase.replace(/\{(\w+)\}/g, (slot, name: string) => {
        const value = values[name];
        return value === undefined ? slot : String(value);
    });
}

/**
 * Renders a label that may name a phrase or already be one.
 *
 * An addon ships labels the build has never heard of, and a missing phrase must
 * read as what its author wrote rather than as the key they chose.
 *
 * @param translate - The renderer for the language in force.
 * @param labelKey - A catalogue key, or the label itself.
 * @returns The text to draw.
 */
export function translateLabel(translate: Translate, labelKey: string): string {
    return isTranslationKey(labelKey) ? translate(labelKey) : labelKey;
}

function isTranslationKey(candidate: string): candidate is TranslationKey {
    return Object.hasOwn(DICTIONARIES.en, candidate);
}
