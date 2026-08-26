import {
    DEFAULT_PREFERENCES,
    PreferencesService,
} from '../../../src/app/services/preferences-service.ts';
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

        expect(service.read().addedIndicators).toEqual(DEFAULT_PREFERENCES.addedIndicators);
    });

    it('carries a reader who had turned a layer off', () => {
        // A document written before the host layers joined the list. Turning the
        // profile off was a decision, and seeding the defaults would hand it
        // back every time the page opened.
        const service = new PreferencesService({
            storage: buildStorage(JSON.stringify({ isVolumeProfileVisible: false })),
        });

        const added = service.read().addedIndicators.map((entry) => entry.indicatorId);
        expect(added).toContain('depth');
        expect(added).not.toContain('profile');
    });

    it('carries the cuts a reader had moved', () => {
        const service = new PreferencesService({
            storage: buildStorage(JSON.stringify({ colourGain: 2.5, depthFloorPercentile: 0.2 })),
        });

        const depth = service.read().addedIndicators.find((entry) => entry.indicatorId === 'depth');
        expect(depth?.settings).toMatchObject({ colourGain: 2.5, floorPercentile: 0.2 });
    });

    it('migrates once, and leaves a later removal alone', () => {
        const migrated = new PreferencesService({
            storage: buildStorage(JSON.stringify({ isVolumeProfileVisible: false })),
        }).read();

        const reread = new PreferencesService({
            storage: buildStorage(JSON.stringify({ ...migrated, addedIndicators: [] })),
        }).read();

        expect(reread.addedIndicators).toEqual([]);
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

        service.write({ ...DEFAULT_PREFERENCES, visibleSpanMs: 120_000 });

        expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.stringContaining('"visibleSpanMs":120000'));
    });

    it('survives a storage that refuses the write', () => {
        const storage = buildStorage(null);
        vi.mocked(storage.setItem).mockImplementation(() => { throw new Error('quota exceeded'); });
        const service = new PreferencesService({ storage });

        expect(() => { service.write(DEFAULT_PREFERENCES); }).not.toThrow();
    });
});
