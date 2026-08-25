import {
    applyFormattingLocale,
    formatAxisTime,
    formatClockTime,
    formatDuration,
    formatFixed,
    formatPrice,
    formatQuantity,
    resolveBaseAsset,
} from '../../../src/app/core/formatting.ts';
import { afterEach, describe, expect, it } from 'vitest';

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
    it('reads a sub-minute span in seconds', () => {
        expect(formatDuration(2_000)).toBe('2s');
    });

    it('reads a multi-minute span in minutes', () => {
        expect(formatDuration(300_000)).toBe('5min');
    });

    it('reads a multi-hour span in hours', () => {
        expect(formatDuration(4 * ONE_HOUR_MS)).toBe('4h');
    });

    it('reads a multi-day span in days', () => {
        expect(formatDuration(3 * ONE_DAY_MS)).toBe('3d');
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
