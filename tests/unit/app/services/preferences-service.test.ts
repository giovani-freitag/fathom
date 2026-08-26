import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, PreferencesService } from '../../../../src/app/services/preferences-service.ts';
import { MAXIMUM_STORED_INDICATORS } from '../../../../src/shared/core/indicator-selection.ts';

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

function readIndicators(stored: Record<string, unknown>): ReturnType<PreferencesService['read']>['addedIndicators'] {
    return new PreferencesService({
        storage: buildStorage({ schemaVersion: 3, ...stored }),
    }).read().addedIndicators;
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

    it('bounds a document that arrives corrupt, without limiting a real chart', () => {
        const tooMany = Array.from({ length: MAXIMUM_STORED_INDICATORS * 3 }, (_, index) => ({
            instanceId: `ema-${index}`, indicatorId: 'ema', settings: {}, tone: 'amber',
        }));

        expect(readIndicators({ addedIndicators: tooMany })).toHaveLength(MAXIMUM_STORED_INDICATORS);
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

    it('opens a new chart on everything it can draw', () => {
        // Nothing stored at all. The chart a reader has never touched shows the
        // book, the candles, how much traded and where it traded.
        const service = new PreferencesService({ storage: buildStorage(undefined) });

        expect(service.read().addedIndicators).toEqual(DEFAULT_PREFERENCES.addedIndicators);
        expect(DEFAULT_PREFERENCES.addedIndicators.map((entry) => entry.indicatorId))
            .toEqual(['depth', 'candles', 'volume']);
    });

    it('carries a reader whose volume was a switch inside the book', () => {
        // How much traded is drawn from the bars, so it never needed the book.
        // A reader who had it on keeps it, as the entry of its own it becomes.
        const service = new PreferencesService({
            storage: buildStorage({
                schemaVersion: 3,
                addedIndicators: [{
                    instanceId: 'depth-1',
                    indicatorId: 'depth',
                    settings: { showVolume: true, volumeMode: 'sides' },
                    tone: 'muted',
                }],
            }),
        });

        const added = service.read().addedIndicators;

        expect(added.map((entry) => entry.indicatorId)).toEqual(['depth', 'volume']);
        expect(added[1]?.settings['volumeMode']).toBe('sides');
        expect(added[0]?.settings['showVolume']).toBeUndefined();
    });

    it('hands the volume even to a reader whose switch reads off', () => {
        // The switch was off unless they went and found it, so an answer of off
        // says what the default was rather than what they decided.
        const service = new PreferencesService({
            storage: buildStorage({
                schemaVersion: 3,
                addedIndicators: [{
                    instanceId: 'depth-1',
                    indicatorId: 'depth',
                    settings: { showVolume: false },
                    tone: 'muted',
                }],
            }),
        });

        expect(service.read().addedIndicators.map((entry) => entry.indicatorId)).toEqual(['depth', 'volume']);
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

describe('PreferencesService bands', () => {
    it('keeps two readings in the band the reader put them in', () => {
        const added = readIndicators({
            addedIndicators: [
                { instanceId: 'rsi-1', indicatorId: 'rsi', settings: {}, tone: 'phosphor' },
                { instanceId: 'rsi-2', indicatorId: 'rsi', settings: {}, tone: 'amber', bandKey: 'rsi-1' },
            ],
        });

        expect(added[1]?.bandKey).toBe('rsi-1');
    });

    it('drops a band that names nothing on the chart', () => {
        // The named indicator may have been trimmed away, or never stored at
        // all; a band pointing at nothing would strand its member alone.
        const added = readIndicators({
            addedIndicators: [
                { instanceId: 'rsi-1', indicatorId: 'rsi', settings: {}, tone: 'phosphor', bandKey: 'ghost-9' },
            ],
        });

        expect(added[0]?.bandKey).toBeUndefined();
    });
});
