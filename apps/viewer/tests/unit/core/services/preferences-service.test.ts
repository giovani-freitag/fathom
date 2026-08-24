import {
    DEFAULT_PREFERENCES,
    PreferencesService,
} from '@core/services/preferences/preferences-service';
import { describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'fathom.preferences.v1';

function buildStorage(stored: string | null): Storage {
    return {
        getItem: vi.fn().mockReturnValue(stored),
        setItem: vi.fn(),
    } as unknown as Storage;
}

describe('PreferencesService.read', () => {
    it('falls back to the defaults without any storage', () => {
        const service = new PreferencesService({ storage: null });

        expect(service.read()).toEqual(DEFAULT_PREFERENCES);
    });

    it('falls back to the defaults on nothing stored', () => {
        const service = new PreferencesService({ storage: buildStorage(null) });

        expect(service.read()).toEqual(DEFAULT_PREFERENCES);
    });

    it('falls back to the defaults on unparseable storage', () => {
        const service = new PreferencesService({ storage: buildStorage('not json') });

        expect(service.read()).toEqual(DEFAULT_PREFERENCES);
    });

    it('fills absent keys from the defaults', () => {
        const service = new PreferencesService({
            storage: buildStorage(JSON.stringify({ instrumentSymbol: 'ETHUSDT' })),
        });

        expect(service.read().colourGain).toBe(DEFAULT_PREFERENCES.colourGain);
    });

    it('pulls a gain saved by a wider slider back into range', () => {
        const service = new PreferencesService({
            storage: buildStorage(JSON.stringify({ colourGain: 6 })),
        });

        expect(service.read().colourGain).toBe(3);
    });

    it('pulls a gain below the current floor up to it', () => {
        const service = new PreferencesService({
            storage: buildStorage(JSON.stringify({ colourGain: 0.05 })),
        });

        expect(service.read().colourGain).toBe(0.4);
    });

    it('repairs a corrupted numeric value', () => {
        const service = new PreferencesService({
            storage: buildStorage(JSON.stringify({ colourGain: 'bright' })),
        });

        expect(service.read().colourGain).toBe(0.4);
    });

    it('bounds a stored span to something the archive could hold', () => {
        const service = new PreferencesService({
            storage: buildStorage(JSON.stringify({ visibleSpanMs: 1 })),
        });

        expect(service.read().visibleSpanMs).toBe(30_000);
    });
});

describe('PreferencesService.write', () => {
    it('stores the complete preference set', () => {
        const storage = buildStorage(null);
        const service = new PreferencesService({ storage });

        service.write({ ...DEFAULT_PREFERENCES, colourGain: 2 });

        expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.stringContaining('"colourGain":2'));
    });

    it('survives a storage that refuses the write', () => {
        const storage = buildStorage(null);
        vi.mocked(storage.setItem).mockImplementation(() => { throw new Error('quota exceeded'); });
        const service = new PreferencesService({ storage });

        expect(() => { service.write(DEFAULT_PREFERENCES); }).not.toThrow();
    });
});
