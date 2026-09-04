import { beforeEach, describe, expect, it } from 'vitest';
import { AddonLibraryService } from '../../../../src/app/services/addon-library/addon-library-service.ts';

/** Storage a test owns, so nothing leaks between them. */
function buildStorage(seeded: string | null = null, seededDraft: string | null = null) {
    const held = new Map<string, string>();
    if (seeded !== null) {
        held.set('fathom.addons', seeded);
    }
    if (seededDraft !== null) {
        held.set('fathom.addons.draft', seededDraft);
    }
    return {
        getItem: (key: string): string | null => held.get(key) ?? null,
        setItem: (key: string, value: string): void => { held.set(key, value); },
        removeItem: (key: string): void => { held.delete(key); },
    };
}

let clock = 1_000;
let storage: ReturnType<typeof buildStorage>;
let library: AddonLibraryService;

beforeEach(() => {
    clock = 1_000;
    storage = buildStorage();
    library = new AddonLibraryService({ storage, now: () => { clock += 1; return clock; } });
});

function saveOne(key: string, name = key): void {
    library.save({ key, name, files: { 'main.ts': `// ${name}` }, compiled: { 'main.ts': `/* ${name} */` } });
}

describe('keeping a reading between sessions', () => {
    it('reads back what was written', () => {
        library.save({ key: 'mean', name: 'My mean', files: { 'main.ts': 'a' }, compiled: { 'main.ts': 'b' } });

        expect(library.find('mean')).toMatchObject({
            name: 'My mean',
            files: { 'main.ts': 'a' },
            compiled: { 'main.ts': 'b' },
        });
    });

    it('keeps the compiled form beside the source', () => {
        // What lets a reload put the reading back on the chart without loading
        // a compiler several times the weight of the app.
        library.save({ key: 'mean', name: 'My mean', files: { 'main.ts': 'a' }, compiled: { 'main.ts': 'b' } });

        expect(library.find('mean')?.compiled).toEqual({ 'main.ts': 'b' });
    });

    it('replaces what was under the same key', () => {
        saveOne('mean', 'First');

        library.save({ key: 'mean', name: 'Second', files: { 'main.ts': 'x' }, compiled: { 'main.ts': 'y' } });

        expect(library.list()).toHaveLength(1);
        expect(library.find('mean')?.name).toBe('Second');
    });

    it('lists the most recently saved first', () => {
        saveOne('one');
        saveOne('two');
        saveOne('three');

        expect(library.list().map((one) => one.key)).toEqual(['three', 'two', 'one']);
    });

    it('takes one off the shelf without touching the rest', () => {
        saveOne('one');
        saveOne('two');

        library.remove('one');

        expect(library.list().map((entry) => entry.key)).toEqual(['two']);
    });

    it('says nothing is there rather than guessing', () => {
        expect(library.find('never-saved')).toBeNull();
    });
});

describe('naming what is saved', () => {
    it('builds a key a person could read in their own storage', () => {
        expect(library.mintKey('My book imbalance')).toBe('my-book-imbalance');
    });

    it('does not hand out a key already taken', () => {
        saveOne('my-mean');

        expect(library.mintKey('My mean')).toBe('my-mean-2');
    });

    it('keeps counting past the second', () => {
        saveOne('my-mean');
        saveOne('my-mean-2');

        expect(library.mintKey('My mean')).toBe('my-mean-3');
    });

    it('folds an accent rather than dropping the letter under it', () => {
        // A name written in a language that uses accents turned into a key with
        // holes where its letters had been.
        expect(library.mintKey('Minha média')).toBe('minha-media');
    });

    it('falls back to a word for a name with nothing usable in it', () => {
        expect(library.mintKey('!!!')).toBe('reading');
    });

    it('keeps the key when the name changes, so a chart keeps its selection', () => {
        library.save({ key: 'mean', name: 'First', files: { 'main.ts': 'a' }, compiled: { 'main.ts': 'b' } });

        library.save({ key: 'mean', name: 'Renamed', files: { 'main.ts': 'a' }, compiled: { 'main.ts': 'b' } });

        expect(library.list()).toHaveLength(1);
        expect(library.find('mean')?.name).toBe('Renamed');
    });
});

describe('what is being written', () => {
    it('waits beside the shelf, not on it', () => {
        library.rememberDraft({ 'main.ts': 'half a reading' });

        expect(library.list()).toEqual([]);
        expect(library.readDraft()).toEqual({ 'main.ts': 'half a reading' });
    });

    it('outlives the page it was written in', () => {
        library.rememberDraft({ 'main.ts': 'half a reading' });

        // A second service over the same storage is what a reload amounts to.
        const afterReload = new AddonLibraryService({ storage, now: () => 1 });

        expect(afterReload.readDraft()).toEqual({ 'main.ts': 'half a reading' });
    });

    it('is gone once there is nothing being written', () => {
        library.rememberDraft({ 'main.ts': 'half a reading' });

        library.rememberDraft(null);

        expect(new AddonLibraryService({ storage, now: () => 1 }).readDraft()).toBeNull();
    });

    it('is never mistaken for a saved reading', () => {
        library.rememberDraft({ 'main.ts': 'half a reading' });
        saveOne('filed');

        expect(library.list().map((one) => one.key)).toEqual(['filed']);
    });
});

describe('storage that will not cooperate', () => {
    it('reads as an empty shelf rather than failing', () => {
        const broken = new AddonLibraryService({
            storage: { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined, removeItem: () => undefined },
            now: () => 1,
        });

        expect(broken.list()).toEqual([]);
    });

    it('leaves the chart working when a save cannot be written', () => {
        const broken = new AddonLibraryService({
            storage: { getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => undefined },
            now: () => 1,
        });

        expect(() => broken.save({ key: 'a', name: 'A', files: { 'main.ts': '' }, compiled: { 'main.ts': '' } })).not.toThrow();
    });

    it('opens a reading filed before one could have more than one file', () => {
        // Storage outlives the shape it was written in. Read as nonsense, the
        // reader opens the page to an empty shelf where their work used to be.
        const older = new AddonLibraryService({
            storage: buildStorage('[{"key":"mean","name":"My mean","source":"a","compiled":"b","savedAtMs":7}]'),
            now: () => 1,
        });

        expect(older.find('mean')).toEqual({
            key: 'mean',
            name: 'My mean',
            files: { 'main.ts': 'a' },
            compiled: { 'main.ts': 'b' },
            savedAtMs: 7,
        });
    });

    it('opens a draft left behind by that same older shape', () => {
        const older = new AddonLibraryService({
            storage: buildStorage(null, 'half a reading'),
            now: () => 1,
        });

        expect(older.readDraft()).toEqual({ 'main.ts': 'half a reading' });
    });

    it('ignores a row that is not a reading rather than crashing on it', () => {
        // Storage outlives the code that wrote it, and something else may have
        // put anything at all under this name.
        const polluted = new AddonLibraryService({
            storage: buildStorage('[{"key":"good","name":"G","source":"","compiled":""},{"nonsense":1}]'),
            now: () => 1,
        });

        expect(polluted.list().map((one) => one.key)).toEqual(['good']);
    });

    it('reads as an empty shelf when what is stored is not a list at all', () => {
        const polluted = new AddonLibraryService({
            storage: buildStorage('not json'),
            now: () => 1,
        });

        expect(polluted.list()).toEqual([]);
    });
});
