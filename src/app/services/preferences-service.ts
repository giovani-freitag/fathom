import { VOLUME } from '../indicators/volume/volume.ts';
import { chooseLayerTone, OPENING_LAYERS, readLayerDefaults } from '../indicators/indicator-catalogue.ts';
import { PLOT_TONES } from '../../shared/core/draw-plan.ts';
import {
    type AddedIndicator,
    chooseInstanceTone,
    MAXIMUM_STORED_INDICATORS,
    withIndicatorAdded,
} from '../../shared/core/indicator-selection.ts';
import { BAR_INTERVALS_MS, type BarIntervalMs } from '../core/bar-interval.ts';
import { type Locale, resolveLocale } from '../i18n/locale.ts';
import { THEME_CHOICES, type ThemeChoice } from '../core/theme.ts';

const STORAGE_KEY = 'fathom.preferences.v1';

/** Bumped when a stored document has to be read differently than it was written. */
const SCHEMA_VERSION = 4;

export interface ViewerPreferences {
    readonly schemaVersion: number;
    readonly instrumentSymbol: string;
    readonly visibleSpanMs: number;
    /** The bar rung the reader named, or null while the window decides. */
    readonly barIntervalMs: BarIntervalMs | null;
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
    barIntervalMs: null,
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
            // A rung the build no longer offers reads as no choice at all,
            // which is the state a chart works in anyway.
            barIntervalMs: BAR_INTERVALS_MS.find((rung) => rung === merged.barIntervalMs) ?? null,
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
 * The opening set, as entries a reader can then tune.
 */
function buildDefaultLayers(): readonly AddedIndicator[] {
    let added: readonly AddedIndicator[] = [];
    for (const layer of OPENING_LAYERS) {
        added = withIndicatorAdded(added, layer.id, readLayerDefaults(layer), chooseLayerTone(layer, added));
    }
    return added;
}

/**
 * Carries a document written while how much traded was a switch inside the book.
 *
 * Everyone is handed the entry, including a reader whose switch reads off: it
 * was off unless they went and found it, so the answer says what the default was
 * rather than what they decided. However they had it tuned is kept.
 *
 * @param stored - The set as the document holds it.
 * @returns The set with the book's volume switch spent for an entry of its own.
 */
function liftVolumeOutOfTheBook(stored: readonly AddedIndicator[]): readonly AddedIndicator[] {
    // Nothing here has been validated yet: it is JSON the reader could have
    // edited, and an entry that is not an object at all reaches this first.
    const book = stored.find((entry) => isSettled(entry) && entry.indicatorId === 'depth');
    const carried = stored.map(withoutVolumeSettings);
    if (book === undefined) {
        return carried;
    }
    return withIndicatorAdded(
        carried,
        VOLUME.id,
        { ...readLayerDefaults(VOLUME), volumeMode: String(book.settings['volumeMode'] ?? 'total') },
        chooseLayerTone(VOLUME, carried),
    );
}

const SPENT_BOOK_SETTINGS = ['showVolume', 'volumeMode'];

/**
 * Whether an entry is shaped enough to read a setting off.
 *
 * The declared type is optimistic here: the list is JSON the reader could have
 * edited, and validation runs after this.
 */
function isSettled(entry: AddedIndicator): boolean {
    const candidate = entry as { settings?: unknown } | null;
    return candidate !== null
        && typeof candidate === 'object'
        && typeof candidate.settings === 'object'
        && candidate.settings !== null;
}

function withoutVolumeSettings(entry: AddedIndicator): AddedIndicator {
    if (!isSettled(entry)) {
        return entry;
    }
    const kept = Object.fromEntries(
        Object.entries(entry.settings).filter(([name]) => !SPENT_BOOK_SETTINGS.includes(name)),
    );
    return { ...entry, settings: kept };
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
    if ((raw.schemaVersion ?? 0) === 3) {
        return liftVolumeOutOfTheBook(raw.addedIndicators ?? []);
    }
    if ((raw.schemaVersion ?? 0) === 2) {
        return liftVolumeOutOfTheBook(foldReadingsIntoTheBook(raw.addedIndicators ?? []));
    }

    const legacy = raw as Record<string, unknown>;
    const wanted = OPENING_LAYERS.filter((layer) => legacy[LEGACY_FLAGS[layer.id] ?? ''] !== false);

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

/** What each reading of the book used to be, before it was a switch inside it. */
const FOLDED_READINGS: Record<string, string> = {
    executions: 'showExecutions',
    profile: 'showProfile',
    volume: 'showVolume',
};

/**
 * Folds the readings of the book back into the book.
 *
 * They were rows of their own, and a reader who turned one off meant it. The
 * switches default to on, so leaving them out would hand back a drawing the
 * reader had dismissed.
 *
 * @param stored - The set as the previous version wrote it.
 * @returns The set with each reading carried as a switch on the book.
 */
function foldReadingsIntoTheBook(stored: readonly AddedIndicator[]): readonly AddedIndicator[] {
    const entries: readonly AddedIndicator[] = Array.isArray(stored) ? stored : [];
    const folded: Record<string, number | string | boolean> = {};

    for (const name of Object.values(FOLDED_READINGS)) {
        folded[name] = false;
    }
    for (const entry of entries) {
        const name = FOLDED_READINGS[entry.indicatorId];
        if (name !== undefined) {
            folded[name] = entry.isHidden !== true;
        }
        if (entry.indicatorId === 'volume' && typeof entry.settings['mode'] === 'string') {
            folded['volumeMode'] = entry.settings['mode'];
        }
    }

    return entries
        .filter((entry) => FOLDED_READINGS[entry.indicatorId] === undefined)
        .map((entry) => (entry.indicatorId === 'depth'
            ? { ...entry, settings: { ...entry.settings, ...folded } }
            : entry));
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

function keepFiniteSettings(
    settings: Record<string, unknown>,
): Record<string, number | string | boolean> {
    const usable: Record<string, number | string | boolean> = {};
    for (const [name, value] of Object.entries(settings)) {
        const isUsable = (typeof value === 'number' && Number.isFinite(value))
            || (typeof value === 'string' && value.length <= 32)
            || typeof value === 'boolean';
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
