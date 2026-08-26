import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, PreferencesService } from '../../../../src/app/services/preferences-service.ts';
import { MAXIMUM_ADDED_INDICATORS } from '../../../../src/shared/core/indicator-selection.ts';

const STORAGE_KEY = 'fathom.preferences.v1';

function buildStorage(stored: unknown): Storage {
    const entries = new Map<string, string>();
    if (stored !== undefined) {
        entries.set(STORAGE_KEY, JSON.stringify(stored));
    }
    return {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); },
    } as unknown as Storage;
}

function readIndicators(stored: unknown): ReturnType<PreferencesService['read']>['addedIndicators'] {
    return new PreferencesService({ storage: buildStorage(stored) }).read().addedIndicators;
}

function readAppearance(stored: Record<string, unknown>): ReturnType<PreferencesService['read']> {
    return new PreferencesService({ storage: buildStorage(stored) }).read();
}

describe('PreferencesService indicators', () => {
    it('keeps a set that was stored properly', () => {
        const added = readIndicators({
            addedIndicators: [
                { instanceId: 'ema-1', indicatorId: 'ema', settings: { periodBars: 50 }, tone: 'amber' },
            ],
        });

        expect(added).toEqual([
            { instanceId: 'ema-1', indicatorId: 'ema', settings: { periodBars: 50 }, tone: 'amber' },
        ]);
    });

    it('drops an entry that is not an indicator at all', () => {
        // Everything here crossed a trust boundary: it is JSON the reader could
        // have edited, arriving before anything has validated it.
        const added = readIndicators({
            addedIndicators: [null, 'ema', 42, { indicatorId: 'ema' }],
        });

        expect(added).toEqual([]);
    });

    it('drops a setting the arithmetic would stall on, and keeps a chosen one', () => {
        // A figure and a choice are both answers a knob can take; a figure that
        // is not a number is not.
        const added = readIndicators({
            addedIndicators: [{
                instanceId: 'ema-1',
                indicatorId: 'ema',
                settings: {
                    deviations: Number.NaN,
                    fastBars: 12,
                    source: 'hl2',
                    rambling: 'x'.repeat(400),
                    nested: { periodBars: 3 },
                },
                tone: 'amber',
            }],
        });

        expect(added[0]?.settings).toEqual({ fastBars: 12, source: 'hl2' });
    });

    it('gives a free colour to a set stored before colours existed', () => {
        const added = readIndicators({
            addedIndicators: [
                { instanceId: 'ema-1', indicatorId: 'ema', settings: {} },
                { instanceId: 'ema-2', indicatorId: 'ema', settings: {}, tone: 'nonsense' },
            ],
        });

        expect(added[0]?.tone).not.toBe(added[1]?.tone);
        expect(added.every((entry) => typeof entry.tone === 'string')).toBe(true);
    });

    it('keeps a stored set to what the chart can actually draw', () => {
        const tooMany = Array.from({ length: 40 }, (_, index) => ({
            instanceId: `ema-${index}`, indicatorId: 'ema', settings: {}, tone: 'amber',
        }));

        expect(readIndicators({ addedIndicators: tooMany })).toHaveLength(MAXIMUM_ADDED_INDICATORS);
    });

    it('drops a repeated instance, which two rows could not be told apart by', () => {
        const added = readIndicators({
            addedIndicators: [
                { instanceId: 'ema-1', indicatorId: 'ema', settings: {}, tone: 'amber' },
                { instanceId: 'ema-1', indicatorId: 'rsi', settings: {}, tone: 'cyan' },
            ],
        });

        expect(added).toHaveLength(1);
    });

    it('falls back to the defaults when nothing was ever stored', () => {
        expect(readIndicators(undefined)).toEqual(DEFAULT_PREFERENCES.addedIndicators);
    });

    it('survives storage holding something that is not JSON', () => {
        const storage = {
            getItem: () => '{ not json',
            setItem: () => undefined,
        } as unknown as Storage;

        expect(new PreferencesService({ storage }).read()).toEqual(DEFAULT_PREFERENCES);
    });
});

describe('PreferencesService appearance', () => {
    it('lands a stored tag on the closest translation it has', () => {
        // A tag reaches the dictionary before anything has looked at it, and one
        // that names no dictionary takes the interface down on the first phrase.
        expect(readAppearance({ locale: 'pt-br' }).locale).toBe('pt-BR');
        expect(readAppearance({ locale: 'pt-PT' }).locale).toBe('pt-BR');
        expect(readAppearance({ locale: 'klingon' }).locale).toBe('en');
        expect(readAppearance({ locale: 42 }).locale).toBe('en');
    });

    it('leaves the choice unmade when nobody has made one', () => {
        expect(readAppearance({ locale: null }).locale).toBeNull();
    });

    it('falls back to following the host when the stored theme names nothing', () => {
        expect(readAppearance({ themeChoice: 'sepia' }).themeChoice).toBe('system');
        expect(readAppearance({ themeChoice: 'light' }).themeChoice).toBe('light');
    });
});
