import { AppearanceController, type AppearanceHost } from '../../../src/app/core/appearance-controller.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, inWords, speakIn } from '../../../src/shared/core/reading-words.ts';
import { PreferencesService } from '../../../src/app/services/preferences-service.ts';

interface HostHandles {
    readonly host: AppearanceHost;
    readonly emitHostChange: (matches: boolean) => void;
    readonly readPaintedTheme: () => string | null;
}

function createHost(prefersDark: boolean, languages: readonly string[] = ['en']): HostHandles {
    const listeners: ((event: MediaQueryListEvent) => void)[] = [];
    let painted: string | null = null;

    return {
        host: {
            rootElement: {
                setAttribute: (_name: string, value: string) => { painted = value; },
            } as unknown as HTMLElement,
            darkQuery: {
                matches: prefersDark,
                addEventListener: (_kind: string, listener: (event: MediaQueryListEvent) => void) => {
                    listeners.push(listener);
                },
                removeEventListener: (_kind: string, listener: (event: MediaQueryListEvent) => void) => {
                    listeners.splice(listeners.indexOf(listener), 1);
                },
            } as unknown as MediaQueryList,
            languages,
        },
        emitHostChange: (matches) => {
            for (const listener of [...listeners]) {
                listener({ matches } as MediaQueryListEvent);
            }
        },
        readPaintedTheme: () => painted,
    };
}

function createStorage(): Storage {
    const entries = new Map<string, string>();
    return {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); },
    } as unknown as Storage;
}

describe('AppearanceController', () => {
    let storage: Storage;

    beforeEach(() => {
        storage = createStorage();
    });

    it('opens in the language the host asks for when nothing was ever chosen', () => {
        const { host } = createHost(true, ['pt-BR', 'en']);

        const controller = new AppearanceController({
            preferences: new PreferencesService({ storage }),
            host,
        });

        expect(controller.store.read().locale).toBe('pt-BR');
    });

    it('puts the readings a reader wrote into that language too', () => {
        // They name themselves, and a reading naming itself in Portuguese
        // beside an interface in English is a page in two languages.
        speakIn(DEFAULT_LOCALE);
        const { host } = createHost(true, ['en']);
        const controller = new AppearanceController({
            preferences: new PreferencesService({ storage }),
            host,
        });

        controller.selectLocale('pt-BR');

        expect(inWords({ en: 'Mean', 'pt-BR': 'Média' })).toBe('Média');
        speakIn(DEFAULT_LOCALE);
    });

    it('starts them in the language it opened in, before anything is chosen', () => {
        speakIn('pt-BR');
        const { host } = createHost(true, ['en']);
        const controller = new AppearanceController({
            preferences: new PreferencesService({ storage }),
            host,
        });

        controller.start();

        expect(inWords({ en: 'Mean', 'pt-BR': 'Média' })).toBe('Mean');
        controller.dispose();
    });

    it('reopens in the language the reader chose, whatever the host asks for', () => {
        const preferences = new PreferencesService({ storage });
        const { host } = createHost(true, ['pt-BR']);
        new AppearanceController({ preferences, host }).selectLocale('en');

        const reopened = new AppearanceController({ preferences, host });

        expect(reopened.store.read().locale).toBe('en');
    });

    it('paints the theme the host prefers while the choice is system', () => {
        const { host, readPaintedTheme } = createHost(false);

        new AppearanceController({ preferences: new PreferencesService({ storage }), host }).start();

        expect(readPaintedTheme()).toBe('light');
    });

    it('follows the host as it changes, while the choice is system', () => {
        const { host, emitHostChange, readPaintedTheme } = createHost(true);
        const controller = new AppearanceController({
            preferences: new PreferencesService({ storage }),
            host,
        });
        controller.start();

        emitHostChange(false);

        expect(readPaintedTheme()).toBe('light');
        expect(controller.store.read().resolvedTheme).toBe('light');
    });

    it('stops following the host once the reader has chosen', () => {
        const { host, emitHostChange, readPaintedTheme } = createHost(true);
        const controller = new AppearanceController({
            preferences: new PreferencesService({ storage }),
            host,
        });
        controller.start();
        controller.selectTheme('dark');

        emitHostChange(false);

        expect(readPaintedTheme()).toBe('dark');
    });

    it('lets go of the host on dispose', () => {
        const { host, emitHostChange, readPaintedTheme } = createHost(true);
        const controller = new AppearanceController({
            preferences: new PreferencesService({ storage }),
            host,
        });
        controller.start();
        controller.dispose();

        emitHostChange(false);

        expect(readPaintedTheme()).toBe('dark');
    });

    it('keeps each choice when the other is written', () => {
        const preferences = new PreferencesService({ storage });
        const { host } = createHost(true);
        const controller = new AppearanceController({ preferences, host });

        controller.selectLocale('pt-BR');
        controller.selectTheme('light');

        expect(preferences.read().locale).toBe('pt-BR');
        expect(preferences.read().themeChoice).toBe('light');
    });

    it('runs without a host, which is how a test outside a DOM builds it', () => {
        const controller = new AppearanceController({
            preferences: new PreferencesService({ storage: null }),
            host: null,
        });

        expect(() => { controller.start(); controller.selectTheme('light'); }).not.toThrow();
    });
});

// Not asserted anywhere else: a chart preference written after an appearance one
// used to replace the whole record and drop it.
describe('PreferencesService', () => {
    it('merges a partial write over what is already stored', () => {
        const preferences = new PreferencesService({ storage: createStorage() });
        preferences.write({ locale: 'pt-BR' });

        preferences.write({ visibleSpanMs: 120_000 });

        expect(preferences.read().locale).toBe('pt-BR');
        expect(preferences.read().visibleSpanMs).toBe(120_000);
    });
});
