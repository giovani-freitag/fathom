import {
    applyFormattingLocale,
    formatAxisTagPrice,
    formatAxisTime,
    formatClockTime,
    formatDuration,
    formatFixed,
    formatPrice,
    formatQuantity,
    formatShortAxisPrice,
    resolveBaseAsset,
} from '../../../src/app/core/formatting.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTranslate } from '../../../src/app/i18n/translator.ts';

const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function localMoment(hours: number, minutes = 0): number {
    const moment = new Date(2026, 7, 24, hours, minutes, 0, 0);
    return moment.getTime();
}

describe('formatAxisTime', () => {
    it('shows seconds on a window measured in minutes', () => {
        expect(formatAxisTime(localMoment(14, 30), 15 * 60 * 1_000)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('drops seconds once the window is measured in hours', () => {
        expect(formatAxisTime(localMoment(14, 30), 4 * ONE_HOUR_MS)).toMatch(/^\d{2}:\d{2}$/);
    });

    it('names the day at midnight, so a wrap can be read', () => {
        expect(formatAxisTime(localMoment(0, 0), ONE_DAY_MS)).not.toMatch(/^\d{2}:\d{2}$/);
    });

    it('keeps clock times either side of that midnight', () => {
        expect(formatAxisTime(localMoment(1, 0), ONE_DAY_MS)).toMatch(/^\d{2}:\d{2}$/);
    });

    it('leaves midnight as a clock time while the window stays short', () => {
        expect(formatAxisTime(localMoment(0, 0), ONE_HOUR_MS)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('names every tick by day once the window spans more than three', () => {
        expect(formatAxisTime(localMoment(14, 30), 7 * ONE_DAY_MS)).not.toMatch(/^\d{2}:\d{2}/);
    });
});

describe('formatQuantity', () => {
    it('keeps three decimals on a size below ten', () => {
        expect(formatQuantity(4.5)).toBe('4.500');
    });

    it('drops to one decimal once the size reaches ten', () => {
        expect(formatQuantity(55.44)).toBe('55.4');
    });

    it('abbreviates a size in the thousands', () => {
        expect(formatQuantity(1_590)).toContain('K');
    });

    it('agrees with the price beside it on what a separator means', () => {
        expect([formatQuantity(9.435), formatPrice(9_435)]).toEqual(['9.435', '9,435']);
    });
});

describe('formatPrice', () => {
    it('groups thousands the way the locale does', () => {
        expect(formatPrice(78_945.7)).toBe('78,945.7');
    });
});

describe('formatDuration', () => {
    const translate = buildTranslate('en');

    it('reads a sub-minute span in seconds', () => {
        expect(formatDuration(2_000, translate)).toBe('2s');
    });

    it('reads a multi-minute span in minutes', () => {
        expect(formatDuration(300_000, translate)).toBe('5min');
    });

    it('reads a multi-hour span in hours', () => {
        expect(formatDuration(4 * ONE_HOUR_MS, translate)).toBe('4h');
    });

    it('reads a multi-day span in days', () => {
        expect(formatDuration(3 * ONE_DAY_MS, translate)).toBe('3d');
    });

    it('abbreviates the unit the way the reader s language does', () => {
        expect(formatDuration(3 * ONE_DAY_MS, buildTranslate('pt-BR'))).toBe('3d');
    });
});

describe('resolveBaseAsset', () => {
    it('strips the quote currency', () => {
        expect(resolveBaseAsset('BTCUSDT')).toBe('BTC');
    });

    it('prefers the longest matching quote', () => {
        expect(resolveBaseAsset('ETHUSDC')).toBe('ETH');
    });

    it('leaves an unrecognised symbol alone', () => {
        expect(resolveBaseAsset('XBTZ26')).toBe('XBTZ26');
    });
});

describe('applyFormattingLocale', () => {
    afterEach(() => { applyFormattingLocale('en'); });

    it('separates thousands the way the reader s language does', () => {
        applyFormattingLocale('pt-BR');

        expect(formatPrice(79_150.5)).toBe('79.150,5');
    });

    it('keeps sizes on the same separators as the prices beside them', () => {
        applyFormattingLocale('pt-BR');

        expect(formatQuantity(9.435)).toBe('9,435');
    });

    it('reads the clock in twenty-four hours in every language', () => {
        const afternoon = Date.UTC(2026, 0, 1, 15, 4, 5);

        applyFormattingLocale('en');
        const english = formatClockTime(afternoon);
        applyFormattingLocale('pt-BR');
        const portuguese = formatClockTime(afternoon);

        expect(english).not.toMatch(/[AP]M/i);
        expect(english).toBe(portuguese);
    });
});

describe('formatFixed', () => {
    afterEach(() => { applyFormattingLocale('en'); });

    it('pads to the digits asked for', () => {
        expect(formatFixed(1, 1)).toBe('1.0');
    });

    it('follows the language, so a slider never disagrees with the chart', () => {
        applyFormattingLocale('pt-BR');

        expect(formatFixed(99.5, 1)).toBe('99,5');
    });

    it('groups thousands in a count', () => {
        expect(formatFixed(1_483, 0)).toBe('1,483');
    });
});

describe('formatAxisTagPrice on a narrow axis', () => {
    it('writes the tenth where there is room for it', () => {
        expect(formatAxisTagPrice(80_404.44)).toBe('80,404.4');
    });

    it('drops the tenth where there is not', () => {
        // A phone's axis is forty-six pixels: the decimal is the one character
        // that does not fit, and a tag that runs off the edge is unreadable
        // exactly when it matters most.
        expect(formatAxisTagPrice(80_404.44, true)).toBe('80,404');
    });

    it('keeps the unit, so the tag is still exact inside one price bucket', () => {
        expect(formatAxisTagPrice(80_404.44, true)).toContain('404');
    });
});

describe('formatShortAxisPrice', () => {
    it('abbreviates a price where the labels stay apart', () => {
        expect(formatShortAxisPrice(81_000, 500)).toBe('81.00K');
    });

    it('writes it out where abbreviating would print the same label twice', () => {
        // Over a hundred-unit range, 80.2K and 80.3K are the same label twice.
        expect(formatShortAxisPrice(80_250, 50)).toBe(formatPrice(80_250));
    });

    it('leaves a price under ten thousand alone, which is already short', () => {
        expect(formatShortAxisPrice(3_340, 500)).toBe(formatPrice(3_340));
    });

    it('drops a decimal once the labels are a thousand apart', () => {
        expect(formatShortAxisPrice(81_000, 1_000)).toBe('81.0K');
    });
});
