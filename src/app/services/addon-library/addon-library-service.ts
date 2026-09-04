import { ENTRY_FILE, isLegalPath, type ReadingFiles } from '../../../shared/core/reading-files.ts';

/** One reading a reader wrote, as it is kept between sessions. */
export interface SavedReading {
    /** Stable across renames, because the chart stores selections against it. */
    readonly key: string;
    readonly name: string;
    /** What the reader wrote, by path within the reading. */
    readonly files: ReadingFiles;
    /**
     * The JavaScript the editor emitted, by the same paths.
     *
     * Kept beside the source so a reload can put the reading back on the chart
     * without loading a compiler, which is several times the weight of the app.
     */
    readonly compiled: ReadingFiles;
    readonly savedAtMs: number;
}

/** What is in the editor but not yet on the shelf, and which reading it belongs to. */
export interface HeldDraft {
    /** The shelf key it was opened from, or null for one never saved. */
    readonly key: string | null;
    readonly files: ReadingFiles;
}

/** A reading as it was stored before one could be written across several files. */
interface OneFileReading {
    readonly key: string;
    readonly name: string;
    readonly source: string;
    readonly compiled: string;
}

export interface AddonLibraryServiceConfig {
    /** Where the readings are kept. Injected so a test can hold them in memory. */
    readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    /** Stamps a save, so a list can be ordered by when it was last touched. */
    readonly now: () => number;
}

const SHELF = 'fathom.addons';

/** Where what is being written waits, which is not the shelf. */
const DRAFT = 'fathom.addons.draft';

/**
 * The readings a reader has written, kept between sessions.
 *
 * A store rather than a preference: these are documents with names, they are
 * far larger than a setting, and losing one to a preferences migration would
 * lose work rather than a choice.
 */
export class AddonLibraryService {
    private readonly config: AddonLibraryServiceConfig;
    private draft: HeldDraft | null = null;

    constructor(config: AddonLibraryServiceConfig) {
        this.config = config;
    }

    /**
     * Holds what is being written, until it is filed or thrown away.
     *
     * Beside the shelf rather than on it: it is not a saved reading and must
     * not read as one. What it survives is the editor being taken down and put
     * back — a narrowed window, a rotated tablet, a zoom, a closed tab — none
     * of which is a decision to discard work.
     *
     * @param draft - What is in the editor and which reading it is, or null
     *     once it is filed.
     */
    rememberDraft(draft: HeldDraft | null): void {
        this.draft = draft;
        try {
            if (draft === null) {
                this.config.storage.removeItem(DRAFT);
                return;
            }
            this.config.storage.setItem(DRAFT, JSON.stringify(draft));
        } catch {
            // Storage refused. The draft still survives a remount in memory;
            // what is lost is only its surviving the tab being closed.
        }
    }

    /** What was being written when the editor last went away. */
    readDraft(): HeldDraft | null {
        if (this.draft !== null) {
            return this.draft;
        }
        try {
            const held = this.config.storage.getItem(DRAFT);
            return held === null ? null : readDraftShape(held);
        } catch {
            return null;
        }
    }

    /**
     * Every saved reading, newest first.
     *
     * @returns What is on the shelf, or none where it cannot be read.
     */
    list(): readonly SavedReading[] {
        return [...this.read().values()].sort((one, other) => other.savedAtMs - one.savedAtMs);
    }

    /**
     * One saved reading.
     *
     * @param key - What it was saved under.
     * @returns The reading, or null where nothing is saved under that key.
     */
    find(key: string): SavedReading | null {
        return this.read().get(key) ?? null;
    }

    /**
     * Writes a reading, replacing whatever was under the same key.
     *
     * @param reading - What to keep, without its stamp.
     * @returns What was kept, or null where the shelf refused it.
     */
    save(reading: Omit<SavedReading, 'savedAtMs'>): SavedReading | null {
        const saved = { ...reading, savedAtMs: this.config.now() };
        const held = this.read();
        held.set(saved.key, saved);
        // Read back rather than trusted: storage that is full or refused throws
        // on the write, and a reader told their work is filed when it is not
        // loses it at the next reload with nothing having said so.
        return this.write(held) && this.read().has(saved.key) ? saved : null;
    }

    /**
     * Takes a reading off the shelf.
     *
     * @param key - What it was saved under.
     */
    remove(key: string): void {
        const held = this.read();
        held.delete(key);
        this.write(held);
    }

    /**
     * A key nothing is saved under yet.
     *
     * Built from the name so the stored document is legible to somebody reading
     * their own browser storage, and suffixed where the name is taken.
     *
     * @param name - What the reader called it.
     * @returns A key free on the shelf as it stands.
     */
    mintKey(name: string): string {
        // Accents folded rather than dropped: a name written in a language that
        // uses them turned into a key with holes where its letters had been.
        const stem = name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'reading';
        const held = this.read();
        if (!held.has(stem)) {
            return stem;
        }
        for (let ordinal = 2; ; ordinal += 1) {
            const candidate = `${stem}-${ordinal}`;
            if (!held.has(candidate)) {
                return candidate;
            }
        }
    }

    private read(): Map<string, SavedReading> {
        try {
            const held = this.config.storage.getItem(SHELF);
            const parsed = held === null ? [] : JSON.parse(held) as unknown[];
            const readings = parsed.map(asReading).filter((one) => one !== null);
            return new Map(readings.map((one) => [one.key, one]));
        } catch {
            // Unreadable storage reads as an empty shelf rather than as a
            // failure: a reader whose browser refuses it still gets the editor.
            return new Map();
        }
    }

    /**
     * Writes the shelf.
     *
     * @param held - What the shelf should hold.
     * @returns Whether it landed.
     */
    private write(held: Map<string, SavedReading>): boolean {
        try {
            this.config.storage.setItem(SHELF, JSON.stringify([...held.values()]));
            return true;
        } catch {
            // Storage full or refused. What is on the chart keeps working; what
            // is lost is the save, and the caller has to say so.
            return false;
        }
    }
}

/**
 * One stored reading, in whichever shape it was written in.
 *
 * A reading filed before a reading could have more than one file is read as a
 * reading with one: the alternative is a reader opening the page to an empty
 * shelf where their work used to be.
 */
function asReading(candidate: unknown): SavedReading | null {
    const one = candidate as Partial<SavedReading & OneFileReading> | null;
    if (one === null || typeof one.key !== 'string' || typeof one.name !== 'string') {
        return null;
    }

    const savedAtMs = typeof one.savedAtMs === 'number' ? one.savedAtMs : 0;
    if (typeof one.source === 'string' && typeof one.compiled === 'string') {
        return {
            key: one.key,
            name: one.name,
            files: { [ENTRY_FILE]: one.source },
            compiled: { [ENTRY_FILE]: one.compiled },
            savedAtMs,
        };
    }
    if (isFileMap(one.files) && isFileMap(one.compiled)) {
        return { key: one.key, name: one.name, files: one.files, compiled: one.compiled, savedAtMs };
    }
    return null;
}

/**
 * A draft in whichever shape it was written in.
 *
 * Two older shapes: a bare string from before a reading could have more than
 * one file, and a file map from before a draft said which reading it was. Both
 * read as a draft belonging to no reading, which is the safe answer — it is
 * offered to a reader opening nothing rather than filed over something.
 */
function readDraftShape(held: string): HeldDraft | null {
    try {
        const parsed = JSON.parse(held) as { key?: unknown; files?: unknown };
        if (isFileMap(parsed.files)) {
            return { key: typeof parsed.key === 'string' ? parsed.key : null, files: parsed.files };
        }
        return isFileMap(parsed) ? { key: null, files: parsed } : { key: null, files: { [ENTRY_FILE]: held } };
    } catch {
        return { key: null, files: { [ENTRY_FILE]: held } };
    }
}

/**
 * Whether something read out of storage is a reading's files.
 *
 * The paths are checked as the editor checks them. Storage outlives the code
 * that wrote it, and a path the editor would refuse to create is one it should
 * refuse to open — it goes straight into a model's address.
 */
function isFileMap(candidate: unknown): candidate is ReadingFiles {
    return typeof candidate === 'object'
        && candidate !== null
        && !Array.isArray(candidate)
        && Object.entries(candidate).every(([path, value]) => typeof value === 'string' && isLegalPath(path));
}
