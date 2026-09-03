/** One reading a reader wrote, as it is kept between sessions. */
export interface SavedReading {
    /** Stable across renames, because the chart stores selections against it. */
    readonly key: string;
    readonly name: string;
    readonly source: string;
    /**
     * The JavaScript the editor emitted.
     *
     * Kept beside the source so a reload can put the reading back on the chart
     * without loading a compiler, which is several times the weight of the app.
     */
    readonly compiled: string;
    readonly savedAtMs: number;
}

export interface AddonLibraryServiceConfig {
    /** Where the readings are kept. Injected so a test can hold them in memory. */
    readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
    /** Stamps a save, so a list can be ordered by when it was last touched. */
    readonly now: () => number;
}

const SHELF = 'fathom.addons';

/**
 * The readings a reader has written, kept between sessions.
 *
 * A store rather than a preference: these are documents with names, they are
 * far larger than a setting, and losing one to a preferences migration would
 * lose work rather than a choice.
 */
export class AddonLibraryService {
    private readonly config: AddonLibraryServiceConfig;

    constructor(config: AddonLibraryServiceConfig) {
        this.config = config;
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
     * @returns What was kept, stamped.
     */
    save(reading: Omit<SavedReading, 'savedAtMs'>): SavedReading {
        const saved = { ...reading, savedAtMs: this.config.now() };
        const held = this.read();
        held.set(saved.key, saved);
        this.write(held);
        return saved;
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
        const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reading';
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
            const parsed = held === null ? [] : JSON.parse(held) as SavedReading[];
            return new Map(parsed.filter(isReading).map((one) => [one.key, one]));
        } catch {
            // Unreadable storage reads as an empty shelf rather than as a
            // failure: a reader whose browser refuses it still gets the editor.
            return new Map();
        }
    }

    private write(held: Map<string, SavedReading>): void {
        try {
            this.config.storage.setItem(SHELF, JSON.stringify([...held.values()]));
        } catch {
            // Storage full or refused. What is on the chart keeps working; the
            // save is what is lost, and the editor says so on its own.
        }
    }
}

function isReading(candidate: unknown): candidate is SavedReading {
    const one = candidate as Partial<SavedReading> | null;
    return one !== null
        && typeof one.key === 'string'
        && typeof one.name === 'string'
        && typeof one.source === 'string'
        && typeof one.compiled === 'string';
}
