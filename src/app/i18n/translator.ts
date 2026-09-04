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
 * @param otherwise - What to draw where the key names nothing, for a caller
 *     that built the key out of something more readable than the key is.
 * @returns The text to draw.
 */
/**
 * Why a layer drew nothing, in the reader's language.
 *
 * A reading's own thrown message passes through as its author wrote it; the
 * chart's own refusals arrive as a key and are rendered here.
 *
 * @param translate - The renderer for the reader's language.
 * @param failure - What the chart reported, or null where nothing did.
 * @returns The sentence to show, or null.
 */
export function translateFailure(
    translate: Translate,
    failure: string | { readonly key: TranslationKey; readonly values: TranslationValues } | undefined,
): string | null {
    if (failure === undefined) {
        return null;
    }
    return typeof failure === 'string' ? failure : translate(failure.key, failure.values);
}

/**
 * A label the dictionary may or may not know.
 *
 * @param translate - The renderer for the reader's language.
 * @param labelKey - What the layer called itself, key or plain words.
 * @param otherwise - Shown when the key is unknown. Defaults to the key.
 * @returns The rendered label, or the words as they were written.
 */
export function translateLabel(translate: Translate, labelKey: string, otherwise?: string): string {
    if (isTranslationKey(labelKey)) {
        return translate(labelKey);
    }
    return otherwise ?? labelKey;
}

function isTranslationKey(candidate: string): candidate is TranslationKey {
    return Object.hasOwn(DICTIONARIES.en, candidate);
}
