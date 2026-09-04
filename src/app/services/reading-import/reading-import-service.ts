import { delay } from '../../../shared/core/timers.ts';
import { ENTRY_FILE, isLegalPath, type ReadingFiles } from '../../../shared/core/reading-files.ts';

/** Where a reading is being brought in from. */
export interface ReadingSpec {
    /** `gh` for a repository, `npm` for a package. */
    readonly host: 'gh' | 'npm';
    /** `user/repo` for a repository, the package name for a package. */
    readonly name: string;
    /** A tag, branch or version, or null for whatever is newest. */
    readonly version: string | null;
    /** Which folder within it holds the reading, empty for the whole of it. */
    readonly folder: string;
}

/** One file found at a spec, before it has been fetched. */
export interface FoundFile {
    /** Its path within the reading, so `main.ts` rather than `readings/a/main.ts`. */
    readonly path: string;
    /** Where to fetch it from, which differs where an entry was renamed. */
    readonly readAt: string;
    readonly bytes: number;
}

/** What is at a spec, as much as can be told without fetching any of it. */
export interface FoundReading {
    /** What to call it, taken from the repository or package. */
    readonly name: string;
    /** Where it came from, to show the reader before they run it. */
    readonly from: string;
    readonly files: readonly FoundFile[];
    readonly bytes: number;
}

export interface ReadingImportServiceConfig {
    /** Injected so a test needs no network. */
    readonly fetch: typeof globalThis.fetch;
}

/** How many files a reading may be brought in as. */
const MOST_FILES = 40;

/** How much a reading may weigh, all its files together. */
const MOST_BYTES = 512 * 1024;

const LISTING = 'https://data.jsdelivr.com/v1/packages';
const CONTENT = 'https://cdn.jsdelivr.net';

/**
 * How many files are fetched at once, and how long a refused one waits.
 *
 * A reading of twenty files asked for in one breath had some of them answered
 * with a 404 that a second, quieter ask returned in full.
 */
const AT_ONCE = 6;
const BEFORE_ASKING_AGAIN_MS = 400;

/**
 * Brings a reading in from a repository or a package.
 *
 * Through jsDelivr rather than either host's own API: it serves GitHub and npm
 * through one shape, answers a browser directly, and is not rate-limited per
 * reader the way an unauthenticated GitHub API call is.
 */
export class ReadingImportService {
    private readonly config: ReadingImportServiceConfig;

    constructor(config: ReadingImportServiceConfig) {
        this.config = config;
    }

    /**
     * What is at a spec, without fetching any of the code.
     *
     * Separated from taking it so a reader is told what they are about to run
     * before any of it arrives.
     *
     * @param typed - A spec or a pasted address.
     * @returns What was found there.
     * @throws Error naming what is wrong, in words a reader can act on.
     */
    async look(typed: string): Promise<FoundReading> {
        const spec = readSpec(typed);
        const listing = await this.readListing(spec);
        const found = withEntry(withinFolder(listing, spec.folder));

        if (found.length === 0) {
            throw new Error(`Nothing at ${describe(spec)} is a TypeScript file this could open.`);
        }
        if (!found.some((one) => one.path === ENTRY_FILE)) {
            throw new Error(
                `A reading needs a ${ENTRY_FILE} or an index.ts, and there is neither at ${describe(spec)}.`,
            );
        }
        if (found.length > MOST_FILES) {
            throw new Error(`That is ${found.length} files. A reading may be up to ${MOST_FILES}.`);
        }

        const bytes = found.reduce((total, one) => total + one.bytes, 0);
        if (bytes > MOST_BYTES) {
            throw new Error(`That weighs ${Math.round(bytes / 1024)} kB. A reading may be up to ${MOST_BYTES / 1024} kB.`);
        }

        return { name: nameOf(spec), from: describe(spec), files: found, bytes };
    }

    /**
     * Fetches what a look found.
     *
     * @param typed - The same spec the look was made with.
     * @param found - What that look answered.
     * @returns The files, ready to open in the editor.
     * @throws Error when one of them could not be fetched.
     */
    async take(typed: string, found: FoundReading): Promise<ReadingFiles> {
        const spec = readSpec(typed);
        const at = `${CONTENT}/${spec.host}/${nameAndVersion(spec)}`;
        const prefix = spec.folder === '' ? '' : `/${spec.folder}`;

        const fetched: (readonly [string, string])[] = [];
        for (let from = 0; from < found.files.length; from += AT_ONCE) {
            const batch = found.files.slice(from, from + AT_ONCE);
            fetched.push(...await Promise.all(batch.map((one) => this.readFile(`${at}${prefix}`, one))));
        }

        return Object.fromEntries(fetched);
    }

    private async readFile(at: string, one: FoundFile): Promise<readonly [string, string]> {
        const answer = await this.config.fetch(`${at}/${one.readAt}`);
        if (answer.ok) {
            return [one.path, await answer.text()];
        }

        await delay(BEFORE_ASKING_AGAIN_MS);
        const again = await this.config.fetch(`${at}/${one.readAt}`);
        if (!again.ok) {
            throw new Error(`${one.path} could not be fetched (${again.status}).`);
        }
        return [one.path, await again.text()];
    }

    private async readListing(spec: ReadingSpec): Promise<readonly FoundFile[]> {
        const answer = await this.config.fetch(
            `${LISTING}/${spec.host}/${nameAndVersion(spec)}?structure=flat`,
        );
        if (answer.status === 404) {
            throw new Error(`Nothing is published at ${describe(spec)}.`);
        }
        if (!answer.ok) {
            throw new Error(`${describe(spec)} could not be read (${answer.status}).`);
        }

        const held = await answer.json() as { files?: readonly { name?: unknown; size?: unknown }[] };
        return (held.files ?? [])
            .filter((one) => typeof one.name === 'string' && typeof one.size === 'number')
            .map((one) => {
                const path = (one.name as string).replace(/^\//, '');
                return { path, readAt: path, bytes: one.size as number };
            });
    }
}

/**
 * A spec out of whatever the reader typed or pasted.
 *
 * @param typed - `gh/user/repo@ref/folder`, `npm/package@version`, or an
 *     address copied out of a browser's bar.
 * @returns Where to look.
 * @throws Error when it names neither a repository nor a package.
 */
export function readSpec(typed: string): ReadingSpec {
    const trimmed = typed.trim();
    const fromWeb = readAddress(trimmed);
    const rest = fromWeb ?? trimmed.replace(/^\/+/, '');

    const asRepository = /^gh\/([^/@\s]+\/[^/@\s]+)(?:@([^/\s]+))?(?:\/(.*))?$/.exec(rest);
    if (asRepository !== null) {
        return {
            host: 'gh',
            name: asRepository[1]!,
            version: asRepository[2] ?? null,
            folder: trimFolder(asRepository[3]),
        };
    }

    const asPackage = /^npm\/((?:@[^/@\s]+\/)?[^/@\s]+)(?:@([^/\s]+))?(?:\/(.*))?$/.exec(rest);
    if (asPackage !== null) {
        return {
            host: 'npm',
            name: asPackage[1]!,
            version: asPackage[2] ?? null,
            folder: trimFolder(asPackage[3]),
        };
    }

    throw new Error(
        'Give a repository as gh/user/repo, or a package as npm/name. An address copied from GitHub or npm works too.',
    );
}

/** The same spec written back out, for a reader to check before they run it. */
export function describe(spec: ReadingSpec): string {
    return `${spec.host}/${nameAndVersion(spec)}${spec.folder === '' ? '' : `/${spec.folder}`}`;
}

function nameAndVersion(spec: ReadingSpec): string {
    return spec.version === null ? spec.name : `${spec.name}@${spec.version}`;
}

function nameOf(spec: ReadingSpec): string {
    const last = (spec.folder === '' ? spec.name : spec.folder).split('/').pop() ?? spec.name;
    return last;
}

/** An address copied out of a browser, turned into the spec it names. */
function readAddress(typed: string): string | null {
    const onGitHub = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?\/?$/
        .exec(typed);
    if (onGitHub !== null) {
        const at = onGitHub[3] === undefined ? '' : `@${onGitHub[3]}`;
        const folder = onGitHub[4] === undefined ? '' : `/${onGitHub[4]}`;
        return `gh/${onGitHub[1]}/${onGitHub[2]}${at}${folder}`;
    }

    const onNpm = /^https?:\/\/(?:www\.)?npmjs\.com\/package\/((?:@[^/]+\/)?[^/]+)\/?$/.exec(typed);
    return onNpm === null ? null : `npm/${onNpm[1]}`;
}

function trimFolder(held: string | undefined): string {
    return (held ?? '').replace(/^\/+|\/+$/g, '');
}

/**
 * The files under the chosen folder, named from inside it.
 *
 * A reading kept in `readings/my-mean` imports `./helpers`, not
 * `./readings/my-mean/helpers`, so what comes in has to be named the way the
 * reading names itself.
 */
function withinFolder(listing: readonly FoundFile[], folder: string): readonly FoundFile[] {
    const prefix = folder === '' ? '' : `${folder}/`;
    return listing
        .filter((one) => one.path.startsWith(prefix))
        // Both, because the folder is put back on when the file is fetched:
        // left whole, `readAt` asks for the folder twice over.
        .map((one) => {
            const within = one.path.slice(prefix.length);
            return { ...one, path: within, readAt: within };
        })
        .filter((one) => isLegalPath(one.path) && !one.path.endsWith('.d.ts'));
}

/**
 * The same files, with an `index.ts` at the top read as the entry.
 *
 * A reading written here starts at `main.ts`, but a repository or a package
 * written anywhere else starts at `index.ts` as often as not, and refusing one
 * over the name of its first file helps nobody.
 */
function withEntry(found: readonly FoundFile[]): readonly FoundFile[] {
    if (found.some((one) => one.path === ENTRY_FILE)) {
        return found;
    }
    return found.map((one) => (
        one.path === 'index.ts' ? { ...one, path: ENTRY_FILE } : one
    ));
}
