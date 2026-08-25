import { describe, expect, it } from 'vitest';
import { resolveLocale } from '../../../../src/app/i18n/locale.ts';

describe('resolveLocale', () => {
    it('takes the first language it can actually render', () => {
        expect(resolveLocale(['de-DE', 'fr', 'pt-BR'])).toBe('pt-BR');
    });

    it('matches a region it does not translate separately to the language it does', () => {
        expect(resolveLocale(['pt-PT'])).toBe('pt-BR');
    });

    it('falls back to English when nothing is recognised', () => {
        expect(resolveLocale(['ja', 'ko'])).toBe('en');
    });

    it('falls back to English when the host says nothing', () => {
        expect(resolveLocale([])).toBe('en');
    });
});
