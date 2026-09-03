import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, inWords, type Locale, speakIn } from '../../../src/shared/core/reading-words.ts';

afterEach(() => { speakIn(DEFAULT_LOCALE); });

describe('a reading naming itself', () => {
    it('answers in the language the page is being read in', () => {
        speakIn('pt-BR');

        expect(inWords({ en: 'My mean', 'pt-BR': 'Minha média' })).toBe('Minha média');
    });

    it('falls back to English rather than to whatever was written first', () => {
        // Read in a language its author did not write it in — which is what
        // every existing reading becomes the day a third language is added.
        // The alternative is whichever key happens to come out first, a name
        // nobody chose.
        speakIn('de' as Locale);

        expect(inWords({ 'pt-BR': 'Minha média', en: 'My mean' })).toBe('My mean');
    });

    it('is in English before the page has said otherwise', () => {
        expect(inWords({ en: 'My mean', 'pt-BR': 'Minha média' })).toBe('My mean');
    });
});
