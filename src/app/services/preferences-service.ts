import {
    DEFAULT_FLOOR_PERCENTILE,
    DEFAULT_SATURATION_PERCENTILE,
} from '../core/chart-dataset.ts';
import type { Locale } from '../i18n/locale.ts';
import type { ThemeChoice } from '../core/theme.ts';

const STORAGE_KEY = 'fathom.preferences.v1';

export interface ViewerPreferences {
    readonly instrumentSymbol: string;
    readonly visibleSpanMs: number;
    readonly colourGain: number;
    readonly depthFloorPercentile: number;
    readonly depthSaturationPercentile: number;
    readonly isCandleOverlayVisible: boolean;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
    /** Null until the reader picks one, which is how the host's own choice wins. */
    readonly locale: Locale | null;
    readonly themeChoice: ThemeChoice;
}

export const DEFAULT_PREFERENCES: ViewerPreferences = {
    instrumentSymbol: 'BTCUSDT',
    visibleSpanMs: 15 * 60 * 1_000,
    colourGain: 1,
    depthFloorPercentile: DEFAULT_FLOOR_PERCENTILE,
    depthSaturationPercentile: DEFAULT_SATURATION_PERCENTILE,
    isCandleOverlayVisible: true,
    isTradeOverlayVisible: true,
    isVolumeProfileVisible: true,
    locale: null,
    themeChoice: 'system',
};

export interface PreferencesServiceConfig {
    /** Absent in a test that runs outside a DOM. */
    readonly storage: Storage | null;
}

/**
 * The only place browser storage is touched.
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

        const merged = { ...DEFAULT_PREFERENCES, ...raw };
        return {
            ...merged,
            // Stored values outlive the control that produced them: a gain saved
            // by an earlier, wider slider would otherwise reopen the chart on a
            // picture the current control cannot undo.
            colourGain: clampToRange(merged.colourGain, 0.4, 3),
            visibleSpanMs: clampToRange(merged.visibleSpanMs, 30_000, 90 * 24 * 60 * 60 * 1_000),
        };
    }

    /**
     * Merges preferences over what is stored, ignoring a storage that refuses.
     *
     * @param preferences - Only the entries that changed.
     */
    write(preferences: Partial<ViewerPreferences>): void {
        try {
            // Merged rather than replaced: the chart and the appearance controls
            // own different entries of one record, and a full write from either
            // would drop whatever the other had just set.
            const merged = { ...this.read(), ...preferences };
            this.storage?.setItem(STORAGE_KEY, JSON.stringify(merged));
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

function clampToRange(value: number, minimum: number, maximum: number): number {
    if (!Number.isFinite(value)) {
        return minimum;
    }
    return Math.min(Math.max(value, minimum), maximum);
}
