import { buildTranslate } from '../../../../src/app/i18n/translator.ts';
import { describe, expect, it } from 'vitest';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import { PT_BR_DICTIONARY } from '../../../../src/app/i18n/dictionaries/pt-br.ts';
import { SUPPORTED_LOCALES } from '../../../../src/app/i18n/locale.ts';

describe('buildTranslate', () => {
    it('renders a phrase in the language it was built for', () => {
        const translate = buildTranslate('pt-BR');

        expect(translate('settings.theme')).toBe('Tema');
    });

    it('substitutes the values a phrase leaves slots for', () => {
        const translate = buildTranslate('en');

        expect(translate('recording.usage', { used: '1.2 GB', total: '10.0 GB' }))
            .toBe('1.2 GB of 10.0 GB');
    });

    it('leaves a slot standing when nothing was given for it', () => {
        const translate = buildTranslate('en');

        expect(translate('recording.toggle')).toBe('Record {symbol}');
    });

    it('answers for every supported language', () => {
        const rendered = SUPPORTED_LOCALES.map((locale) => buildTranslate(locale)('settings.title'));

        expect(rendered.every((phrase) => phrase.length > 0)).toBe(true);
    });
});

describe('the translations', () => {
    it('carry the same slots in every language', () => {
        const mismatched = Object.keys(EN_DICTIONARY).filter((key) => {
            const typedKey = key as keyof typeof EN_DICTIONARY;
            return readSlots(EN_DICTIONARY[typedKey]) !== readSlots(PT_BR_DICTIONARY[typedKey]);
        });

        expect(mismatched).toEqual([]);
    });
});

function readSlots(phrase: string): string {
    return [...phrase.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
}
