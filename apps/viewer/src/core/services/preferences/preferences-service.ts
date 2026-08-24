const STORAGE_KEY = 'fathom.preferences.v1';

export interface ViewerPreferences {
    readonly instrumentSymbol: string;
    readonly visibleSpanMs: number;
    readonly colourGain: number;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
}

export const DEFAULT_PREFERENCES: ViewerPreferences = {
    instrumentSymbol: 'BTCUSDT',
    visibleSpanMs: 15 * 60 * 1_000,
    colourGain: 1,
    isTradeOverlayVisible: true,
    isVolumeProfileVisible: true,
};

export interface PreferencesServiceConfig {
    /** Absent in a test that runs outside a DOM. */
    readonly storage: Storage | null;
}

/**
 * The only place browser storage is touched.
 *
 * Every read falls back to the defaults: storage is unavailable in private
 * windows and can hold anything a previous version wrote, and neither case is
 * worth failing a page load over.
 */
export class PreferencesService {
    private readonly storage: Storage | null;

    constructor(config: PreferencesServiceConfig) {
        this.storage = config.storage;
    }

    /**
     * The stored preferences, merged over the defaults.
     *
     * @returns A complete preference set.
     */
    read(): ViewerPreferences {
        const raw = this.readRaw();
        if (raw === null) {
            return DEFAULT_PREFERENCES;
        }
        return { ...DEFAULT_PREFERENCES, ...raw };
    }

    /**
     * Persists the preferences, ignoring a storage that refuses the write.
     *
     * @param preferences - The complete set to store.
     */
    write(preferences: ViewerPreferences): void {
        try {
            this.storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
        } catch {
            // A full or blocked storage must not break the chart.
        }
    }

    private readRaw(): Partial<ViewerPreferences> | null {
        try {
            const stored = this.storage?.getItem(STORAGE_KEY);
            if (stored === null || stored === undefined) {
                return null;
            }
            const parsed: unknown = JSON.parse(stored);
            return typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }
}
