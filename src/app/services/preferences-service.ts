import { FIELD_LAYERS } from '../indicators/field-layers.ts';
import { chooseLayerTone, readLayerDefaults } from '../indicators/indicator-catalogue.ts';
import { PLOT_TONES } from '../../shared/core/draw-plan.ts';
import {
    type AddedIndicator,
    chooseInstanceTone,
    MAXIMUM_STORED_INDICATORS,
    withIndicatorAdded,
} from '../../shared/core/indicator-selection.ts';
import { type Locale, resolveLocale } from '../i18n/locale.ts';
import { THEME_CHOICES, type ThemeChoice } from '../core/theme.ts';

const STORAGE_KEY = 'fathom.preferences.v1';

/** Bumped when a stored document has to be read differently than it was written. */
const SCHEMA_VERSION = 2;

export interface ViewerPreferences {
    readonly schemaVersion: number;
    readonly instrumentSymbol: string;
    readonly visibleSpanMs: number;
    /**
     * Everything on the chart, host layers and indicators alike.
     *
     * The depth map and the candles used to be flags of their own beside this
     * list. They were the same decision written twice, and the one that could
     * not be tuned, hidden or reordered was the wrong one.
     */
    readonly addedIndicators: readonly AddedIndicator[];
    /** Null until the reader picks one, which is how the host's own choice wins. */
    readonly locale: Locale | null;
    readonly themeChoice: ThemeChoice;
}

export const DEFAULT_PREFERENCES: ViewerPreferences = {
    schemaVersion: SCHEMA_VERSION,
    instrumentSymbol: 'BTCUSDT',
    visibleSpanMs: 15 * 60 * 1_000,
    addedIndicators: buildDefaultLayers(),
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
        const carried = migrateLayers(merged, raw);
        return {
            ...merged,
            // Stored values outlive the control that produced them: a span saved
            // by an earlier, wider control would otherwise reopen the chart on a
            // view the current one cannot undo. A layer's own knobs are clamped
            // where they are read, against the range the layer declares.
            visibleSpanMs: clampToRange(merged.visibleSpanMs, 30_000, 90 * 24 * 60 * 60 * 1_000),
            schemaVersion: SCHEMA_VERSION,
            addedIndicators: keepUsableIndicators(carried),
            // A tag from storage reaches the dictionary before anything has
            // looked at it, and one that names no dictionary takes the whole
            // interface down on the first phrase it tries to render.
            locale: merged.locale === null ? null : resolveLocale([String(merged.locale)]),
            themeChoice: THEME_CHOICES.find((choice) => choice === merged.themeChoice) ?? 'system',
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

/**
 * What a chart shows before anybody has chosen anything.
 */
function buildDefaultLayers(): readonly AddedIndicator[] {
    let added: readonly AddedIndicator[] = [];
    for (const layer of FIELD_LAYERS) {
        added = withIndicatorAdded(added, layer.id, readLayerDefaults(layer), chooseLayerTone(layer, added));
    }
    return added;
}

/**
 * Carries a document written before the host layers joined the list.
 *
 * A reader who had turned the candles off meant it, and a version that simply
 * seeded the defaults would hand them back every time the page opened.
 *
 * @param merged - The stored document over the defaults.
 * @param raw - What was actually stored, for the flags this version dropped.
 * @returns The set to keep.
 */
function migrateLayers(
    merged: ViewerPreferences,
    raw: Partial<ViewerPreferences>,
): readonly AddedIndicator[] {
    // The stored version, not the merged one: merging over the defaults hands
    // every document the current version and the migration never runs.
    if ((raw.schemaVersion ?? 0) >= SCHEMA_VERSION) {
        return merged.addedIndicators;
    }

    const legacy = raw as Record<string, unknown>;
    const wanted = FIELD_LAYERS.filter((layer) => legacy[LEGACY_FLAGS[layer.id] ?? ''] !== false);

    let carried: readonly AddedIndicator[] = [];
    for (const layer of wanted) {
        carried = withIndicatorAdded(
            carried,
            layer.id,
            { ...readLayerDefaults(layer), ...(layer.id === 'depth' ? readLegacyDepth(legacy) : {}) },
            chooseLayerTone(layer, carried),
        );
    }
    // The document's own list, not the merged one: merging over the defaults
    // hands an old document the very layers this is deciding about.
    return [...carried, ...(raw.addedIndicators ?? [])];
}

/** The flag each host layer used to be, before it was a member of the list. */
const LEGACY_FLAGS: Record<string, string> = {
    depth: 'isDepthVisible',
    candles: 'isCandleOverlayVisible',
    executions: 'isTradeOverlayVisible',
    profile: 'isVolumeProfileVisible',
};

function readLegacyDepth(legacy: Record<string, unknown>): Record<string, number> {
    const carried: Record<string, number> = {};
    const pairs: readonly (readonly [string, string])[] = [
        ['colourGain', 'colourGain'],
        ['floorPercentile', 'depthFloorPercentile'],
        ['saturationPercentile', 'depthSaturationPercentile'],
    ];
    for (const [name, stored] of pairs) {
        if (typeof legacy[stored] === 'number') {
            carried[name] = legacy[stored];
        }
    }
    return carried;
}

/**
 * Keeps the stored indicator set to what the chart can actually draw.
 *
 * Everything here crossed a trust boundary: it is JSON the reader could have
 * edited, and it arrives before anything has validated it. A set that is too
 * long, or holds a setting that is not a number, would otherwise reach the
 * arithmetic and stall the first frame.
 */
function keepUsableIndicators(stored: unknown): readonly AddedIndicator[] {
    if (!Array.isArray(stored)) {
        return [];
    }

    // Which instances survive is decided before any band is read: a band naming
    // one stored after it would otherwise be dropped for no reason but order.
    const surviving = new Set(
        (stored as readonly unknown[])
            .filter(isUsableIndicator)
            .slice(0, MAXIMUM_STORED_INDICATORS)
            .map((entry) => entry.instanceId),
    );
    const seen = new Set<string>();
    const kept: AddedIndicator[] = [];
    for (const entry of stored as readonly unknown[]) {
        if (!isUsableIndicator(entry) || seen.has(entry.instanceId)) {
            continue;
        }
        seen.add(entry.instanceId);
        kept.push({
            instanceId: entry.instanceId,
            indicatorId: entry.indicatorId,
            settings: keepFiniteSettings(entry.settings),
            // A set stored before colours existed, or one edited by hand, gets a
            // free colour rather than a blank one. Checked against every tone
            // rather than against the rotation: a layer the host paints holds
            // one from outside it, and replacing that would spend an identity
            // colour on something that never shows it.
            tone: PLOT_TONES.find((tone) => tone === entry.tone) ?? chooseInstanceTone(kept),
            ...(entry.isHidden === true ? { isHidden: true } : {}),
            // Kept only when it names an entry that survived, so a band cannot
            // point at an indicator this build dropped or the trim discarded.
            ...(typeof entry.bandKey === 'string' && surviving.has(entry.bandKey)
                ? { bandKey: entry.bandKey }
                : {}),
        });
        if (kept.length === MAXIMUM_STORED_INDICATORS) {
            break;
        }
    }
    return kept;
}

/** The shape a stored entry has before anything has checked its values. */
interface StoredIndicator {
    readonly instanceId: string;
    readonly indicatorId: string;
    readonly settings: Record<string, unknown>;
    readonly tone?: unknown;
    readonly isHidden?: unknown;
    readonly bandKey?: unknown;
}

function isUsableIndicator(entry: unknown): entry is StoredIndicator {
    if (typeof entry !== 'object' || entry === null) {
        return false;
    }
    const candidate = entry as Record<string, unknown>;
    return typeof candidate['instanceId'] === 'string'
        && typeof candidate['indicatorId'] === 'string'
        && typeof candidate['settings'] === 'object'
        && candidate['settings'] !== null;
}

function keepFiniteSettings(settings: Record<string, unknown>): Record<string, number | string> {
    const usable: Record<string, number | string> = {};
    for (const [name, value] of Object.entries(settings)) {
        const isUsable = (typeof value === 'number' && Number.isFinite(value))
            || (typeof value === 'string' && value.length <= 32);
        if (isUsable) {
            usable[name] = value;
        }
    }
    return usable;
}

function clampToRange(value: number, minimum: number, maximum: number): number {
    if (!Number.isFinite(value)) {
        return minimum;
    }
    return Math.min(Math.max(value, minimum), maximum);
}
