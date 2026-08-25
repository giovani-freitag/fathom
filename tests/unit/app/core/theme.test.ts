import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../../../../src/app/core/theme.ts';

describe('resolveTheme', () => {
    it('follows the host when the reader has not chosen', () => {
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
    });

    it('overrules the host once the reader has chosen', () => {
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
    });
});
