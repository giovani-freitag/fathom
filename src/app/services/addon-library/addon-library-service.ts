import { ENTRY_FILE, type ReadingFiles } from '../../../shared/core/reading-files.ts';

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
    private draft: ReadingFiles | null = null;

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
     * @param files - What is in the editor, or null once it is filed.
     */
    rememberDraft(files: ReadingFiles | null): void {
        this.draft = files;
        try {
            if (files === null) {
                this.config.storage.removeItem(DRAFT);
                return;
            }
            this.config.storage.setItem(DRAFT, JSON.stringify(files));
        } catch {
            // Storage refused. The draft still survives a remount in memory;
            // what is lost is only its surviving the tab being closed.
        }
    }

    /** What was being written when the editor last went away. */
    readDraft(): ReadingFiles | null {
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

/** A draft written before a reading could have more than one file. */
function readDraftShape(held: string): ReadingFiles | null {
    try {
        const parsed = JSON.parse(held) as unknown;
        return isFileMap(parsed) ? parsed : { [ENTRY_FILE]: held };
    } catch {
        return { [ENTRY_FILE]: held };
    }
}

function isFileMap(candidate: unknown): candidate is ReadingFiles {
    return typeof candidate === 'object'
        && candidate !== null
        && !Array.isArray(candidate)
        && Object.values(candidate).every((value) => typeof value === 'string');
}
