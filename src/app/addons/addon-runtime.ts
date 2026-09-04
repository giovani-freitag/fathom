import type { Indicator } from '../../shared/core/draw-plan.ts';
import * as ADDON_API from '../../shared/core/addon-api.ts';
import { buildAddonConsole } from './addon-console.ts';
import { ENTRY_FILE, isWithin, type ReadingFiles, resolveWithin } from '../../shared/core/reading-files.ts';

/** What an addon's files are turned into, or why they could not be. */
export type AddonBuild =
    | { readonly kind: 'ready'; readonly indicator: Indicator }
    | {
        readonly kind: 'failed';
        readonly message: string;
        readonly line?: number;
        /** Which file it went wrong in, absent where that could not be told. */
        readonly file?: string;
    };

/** The specifier an addon imports the surface from. */
export const ADDON_MODULE = 'fathom';

/**
 * Runs an addon's compiled files and takes the default export of its entry.
 *
 * CommonJS rather than modules: the emitted `require` is a function we hand
 * over, so the surface and the reading's own files reach each other without an
 * import map, a blob URL or anything else the page has to resolve at run time.
 *
 * @param compiled - JavaScript the editor's compiler emitted, by path.
 * @returns The reading it exports, or why it could not be taken.
 */
export function buildAddon(compiled: ReadingFiles): AddonBuild {
    const linker = new Linker(compiled);
    try {
        const entry = linker.load(ENTRY_FILE);
        const built = takeIndicator(readDefault(entry));
        if (built.kind === 'ready') {
            linker.answerTo(built.indicator.label);
        }
        return built;
    } catch (error) {
        return {
            kind: 'failed',
            message: describeFailure(error),
            ...findLine(error),
            ...(linker.blamed === null ? {} : { file: linker.blamed }),
        };
    }
}

/**
 * Runs the files of one reading, each once, resolving what they ask of each other.
 *
 * A class rather than a closure because a failure has to be able to say which
 * file it happened in, and that is state the run carries as it goes.
 */
class Linker {
    /** Where it went wrong: the innermost file the escaping failure came from. */
    blamed: string | null = null;

    /**
     * Which failure that blame is about.
     *
     * Held because every file on the way up catches the same one to say so, and
     * the innermost is the one that knows where it started. Without it the
     * blame is either the outermost file — the entry, always — or the first
     * throw of the run, which a `require` in a try/catch makes a file that was
     * never the problem.
     */
    private blamedFor: unknown = null;

    private readonly files: ReadingFiles;
    private readonly loaded = new Map<string, { exports: unknown }>();
    private label = '';

    constructor(files: ReadingFiles) {
        this.files = files;
    }

    /** Names the reading, so what it prints can be told from another's. */
    answerTo(label: string): void {
        this.label = label;
    }

    /**
     * Runs one file and hands back what it exported.
     *
     * @param path - The file's path within the reading.
     * @returns Its exports, run only the first time it is asked for.
     * @throws Error when the reading has no such file.
     */
    load(path: string): unknown {
        // Held in a box rather than as the exports themselves, because a file
        // may legitimately export `undefined` — and a bare map cannot tell that
        // from a file nobody has run yet, so it ran again on every ask.
        const held = this.loaded.get(path);
        if (held !== undefined) {
            return held.exports;
        }

        const source = this.files[path];
        if (source === undefined) {
            throw new Error(`This reading has no ${path}.`);
        }

        const exported: Record<string, unknown> = {};
        const holder: { exports: unknown } = { exports: exported };
        // Filed before it runs, so two files that import each other get each
        // other's exports as far as they are filled rather than for ever.
        this.loaded.set(path, { exports: exported });

        try {
            // Running a reader's own code is the whole feature. What contains
            // it is what `require` hands over and nothing else in scope.
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            const run = new Function('exports', 'module', 'require', 'console', source) as (
                exports: Record<string, unknown>,
                module: { exports: Record<string, unknown> },
                require: (specifier: string) => unknown,
                printer: ReturnType<typeof buildAddonConsole>,
            ) => void;
            // Named as a parameter so it shadows the page's own inside the
            // script: what a reading prints belongs in the panel beside it.
            run(
                exported,
                holder as { exports: Record<string, unknown> },
                (specifier) => this.reach(specifier, path),
                buildAddonConsole(() => this.label),
            );
        } catch (error) {
            // Unfiled, so the next ask runs it again and throws again. Left
            // filed, a second `require` handed back whatever the file managed
            // to assign before it died and the reading built on the wreckage.
            this.loaded.delete(path);
            if (this.blamedFor !== error) {
                this.blamed = path;
                this.blamedFor = error;
            }
            throw error;
        }

        // Read after the run rather than before: a file that replaces
        // `module.exports` wholesale exports something other than what was filed.
        this.loaded.set(path, { exports: holder.exports });
        return holder.exports;
    }

    private reach(specifier: string, from: string): unknown {
        if (specifier === ADDON_MODULE) {
            return ADDON_API;
        }
        if (!isWithin(specifier)) {
            throw new Error(
                `An addon can import '${ADDON_MODULE}' and its own files. Asked for '${specifier}'.`,
            );
        }

        const path = resolveWithin(specifier, from, Object.keys(this.files));
        if (path === null) {
            throw new Error(`Nothing in this reading answers to '${specifier}'.`);
        }
        return this.load(path);
    }
}

/**
 * Checks that what was exported can actually be drawn.
 *
 * Every miss is named rather than left to fail later inside the chart, where
 * the reading simply would not appear.
 */
function takeIndicator(exported: unknown): AddonBuild {
    if (exported === undefined || exported === null) {
        return { kind: 'failed', message: 'Nothing was exported. Add `export default class … `.' };
    }

    const candidate = typeof exported === 'function'
        ? tryConstruct(exported as new () => unknown)
        : exported;
    if (candidate instanceof Error) {
        return { kind: 'failed', message: candidate.message };
    }

    const missing = ['label', 'parameters', 'compute']
        .filter((field) => (candidate as Record<string, unknown>)[field] === undefined);
    if (missing.length > 0) {
        return { kind: 'failed', message: `The export is missing: ${missing.join(', ')}.` };
    }
    if (typeof (candidate as Indicator).compute !== 'function') {
        return { kind: 'failed', message: '`compute` has to be a method.' };
    }

    return { kind: 'ready', indicator: candidate as Indicator };
}

/** The default export of a file, where it exported anything at all. */
function readDefault(exported: unknown): unknown {
    return typeof exported === 'object' && exported !== null
        ? (exported as Record<string, unknown>)['default']
        : undefined;
}

function tryConstruct(Constructor: new () => unknown): unknown {
    try {
        return new Constructor();
    } catch (error) {
        return new Error(`Could not construct the export: ${describeFailure(error)}`);
    }
}

function describeFailure(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The line of the addon's own source a thrown error came from, where known. */
function findLine(error: unknown): { line?: number } {
    const stack = error instanceof Error ? error.stack ?? '' : '';
    const found = /<anonymous>:(\d+):\d+/.exec(stack);
    // The wrapper adds two lines above the source it was given.
    return found === null ? {} : { line: Math.max(1, Number(found[1]) - 2) };
}
