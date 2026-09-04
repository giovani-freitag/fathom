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
    /** What the listing says its content hashes to, where it says. */
    readonly hash: string | null;
}

/** What is at a spec, as much as can be told without fetching any of it. */
export interface FoundReading {
    /** What to call it, taken from the repository or package. */
    readonly name: string;
    /**
     * Exactly what was listed, version resolved.
     *
     * Carried rather than read again from what the reader typed: the field is
     * still theirs to edit after a look, and fetching from a spec nobody was
     * shown is the one thing this two-step flow exists to prevent.
     */
    readonly at: ReadingSpec;
    /** Where it came from, to show the reader before they run it. */
    readonly from: string;
    readonly files: readonly FoundFile[];
    readonly bytes: number;
}

export interface ReadingImportServiceConfig {
    /** Injected so a test needs no network. */
    readonly fetch: typeof globalThis.fetch;
    /** Absent where the page is not a secure context, and then only size is checked. */
    readonly digest?: ((data: ArrayBuffer) => Promise<ArrayBuffer>) | undefined;
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
 * What a repository with no release is read at.
 *
 * jsDelivr indexes a repository by its tags, and most repositories have none —
 * asked for one, it answers with an empty list of versions, which read as a
 * repository with nothing in it. A branch is a ref it serves just as happily.
 */
const DEFAULT_BRANCHES = ['main', 'master'];

/**
 * What a name and a version may be made of.
 *
 * Everything else, a backslash above all: a browser reads one as a separator
 * and resolves the `..` around it, so a name nobody would blink at fetched a
 * different package entirely while the panel showed what was typed.
 */
const REPOSITORY_NAME = /^[\w.-]+\/[\w.-]+$/;
const PACKAGE_NAME = /^(?:@[\w.-]+\/)?[\w.-]+$/;
const PLAIN_VERSION = /^[\w.-]+$/;

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
     * @returns What was found there, at the version it was found at.
     * @throws Error naming what is wrong, in words a reader can act on.
     */
    async look(typed: string): Promise<FoundReading> {
        const { at, listing } = await this.findListing(readSpec(typed));
        const found = withEntry(withinFolder(listing, at.folder));

        if (found.length === 0) {
            throw new Error(`Nothing at ${describe(at)} is a TypeScript file this could open.`);
        }
        if (!found.some((one) => one.path === ENTRY_FILE)) {
            throw new Error(
                `A reading needs a ${ENTRY_FILE} or an index.ts, and there is neither at ${describe(at)}.`,
            );
        }
        if (found.length > MOST_FILES) {
            throw new Error(`That is ${found.length} files. A reading may be up to ${MOST_FILES}.`);
        }

        const bytes = found.reduce((total, one) => total + one.bytes, 0);
        if (bytes > MOST_BYTES) {
            throw new Error(
                `That weighs ${Math.round(bytes / 1024)} kB. A reading may be up to ${MOST_BYTES / 1024} kB.`,
            );
        }

        return { name: nameOf(at), at, from: describe(at), files: found, bytes };
    }

    /**
     * Fetches what a look found, and checks that it is what was listed.
     *
     * @param found - What that look answered, which says where to fetch from.
     * @returns The files, ready to open in the editor.
     * @throws Error when a file could not be fetched, or is not what was shown.
     */
    async take(found: FoundReading): Promise<ReadingFiles> {
        const at = `${CONTENT}/${found.at.host}/${nameAndVersion(found.at)}`;
        const prefix = found.at.folder === '' ? '' : `/${found.at.folder}`;

        const fetched: (readonly [string, string])[] = [];
        for (let from = 0; from < found.files.length; from += AT_ONCE) {
            const batch = found.files.slice(from, from + AT_ONCE);
            fetched.push(...await Promise.all(batch.map((one) => this.readFile(`${at}${prefix}`, one))));
        }

        return Object.fromEntries(fetched);
    }

    /**
     * The files at a spec, and the ref they were actually listed at.
     *
     * The listing needs a ref — asked without one, jsDelivr answers with an
     * index of versions rather than any files. Settling it here also pins the
     * look and the fetch to one ref, so a branch that moves between them
     * cannot.
     */
    private async findListing(
        spec: ReadingSpec,
    ): Promise<{ readonly at: ReadingSpec; readonly listing: readonly FoundFile[] }> {
        if (spec.version !== null) {
            return { at: spec, listing: await this.readListing(spec) };
        }

        const held = await this.readJson(`${LISTING}/${spec.host}/${spec.name}`, spec) as {
            tags?: Record<string, string>;
            versions?: readonly { version?: unknown }[];
        };
        const newest = held.tags?.['latest'] ?? held.versions?.[0]?.version;
        if (typeof newest === 'string') {
            const at = { ...spec, version: newest };
            return { at, listing: await this.readListing(at) };
        }
        if (spec.host !== 'gh') {
            throw new Error(`${describe(spec)} has no released version to open.`);
        }

        for (const branch of DEFAULT_BRANCHES) {
            const at = { ...spec, version: branch };
            const listing = await this.readListing(at).catch(() => []);
            if (listing.length > 0) {
                return { at, listing };
            }
        }
        throw new Error(`${describe(spec)} has no release and no branch this could read.`);
    }

    private async readListing(spec: ReadingSpec): Promise<readonly FoundFile[]> {
        const held = await this.readJson(
            `${LISTING}/${spec.host}/${nameAndVersion(spec)}?structure=flat`,
            spec,
        ) as { files?: readonly { name?: unknown; size?: unknown; hash?: unknown }[] };

        return (held.files ?? [])
            .filter((one) => typeof one.name === 'string' && typeof one.size === 'number')
            .map((one) => {
                const path = (one.name as string).replace(/^\//, '');
                return {
                    path,
                    readAt: path,
                    bytes: one.size as number,
                    hash: typeof one.hash === 'string' ? one.hash : null,
                };
            });
    }

    private async readJson(url: string, spec: ReadingSpec): Promise<unknown> {
        const answer = await this.config.fetch(url);
        if (answer.status === 404) {
            throw new Error(`Nothing is published at ${describe(spec)}.`);
        }
        if (!answer.ok) {
            throw new Error(`${describe(spec)} could not be read (${answer.status}).`);
        }
        return answer.json();
    }

    private async readFile(at: string, one: FoundFile): Promise<readonly [string, string]> {
        const url = `${at}/${one.readAt}`;
        try {
            return [one.path, await this.fetchOnce(url, one)];
        } catch (refusal) {
            if (refusal instanceof Error && refusal.message.includes('not the file that was listed')) {
                throw refusal;
            }
            // Asked once more before giving up: twenty files asked for in one
            // breath came back with some of them refused, and the same ask a
            // moment later answered every one of them.
            await delay(BEFORE_ASKING_AGAIN_MS);
            return [one.path, await this.fetchOnce(url, one)];
        }
    }

    private async fetchOnce(url: string, one: FoundFile): Promise<string> {
        const answer = await this.config.fetch(url);
        if (!answer.ok) {
            throw new Error(`${one.path} could not be fetched (${answer.status}).`);
        }

        // Checked against the listing the reader was shown rather than taken on
        // trust: the listing and the files come from two services with their
        // own caches, and what was approved has to be what runs.
        const bytes = await answer.arrayBuffer();
        if (bytes.byteLength !== one.bytes) {
            throw new Error(`${one.path} is not the file that was listed. Nothing was opened.`);
        }
        await this.checkHash(bytes, one);
        return new TextDecoder().decode(bytes);
    }

    private async checkHash(bytes: ArrayBuffer, one: FoundFile): Promise<void> {
        const digest = this.config.digest;
        if (digest === undefined || one.hash === null) {
            return;
        }

        const hashed = new Uint8Array(await digest(bytes));
        const asBase64 = btoa(String.fromCharCode(...hashed));
        if (asBase64 !== one.hash) {
            throw new Error(`${one.path} is not the file that was listed. Nothing was opened.`);
        }
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
    const rest = readAddress(trimmed) ?? trimmed.replace(/^\/+/, '');

    const asRepository = /^gh\/([^@/\s]+\/[^@/\s]+)(?:@([^/\s]+))?(?:\/(.*))?$/.exec(rest);
    if (asRepository !== null && REPOSITORY_NAME.test(asRepository[1]!)) {
        return buildSpec('gh', asRepository);
    }

    const asPackage = /^npm\/((?:@[^@/\s]+\/)?[^@/\s]+)(?:@([^/\s]+))?(?:\/(.*))?$/.exec(rest);
    if (asPackage !== null && PACKAGE_NAME.test(asPackage[1]!)) {
        return buildSpec('npm', asPackage);
    }

    throw new Error(
        'Give a repository as gh/user/repo, or a package as npm/name. An address copied from GitHub or npm works too.',
    );
}

/** The same spec written back out, for a reader to check before they run it. */
export function describe(spec: ReadingSpec): string {
    return `${spec.host}/${nameAndVersion(spec)}${spec.folder === '' ? '' : `/${spec.folder}`}`;
}

function buildSpec(host: 'gh' | 'npm', found: RegExpExecArray): ReadingSpec {
    const version = found[2];
    if (version !== undefined && !PLAIN_VERSION.test(version)) {
        throw new Error(`“${version}” is not a version, a tag or a branch.`);
    }
    return { host, name: found[1]!, version: version ?? null, folder: trimFolder(found[3]) };
}

function nameAndVersion(spec: ReadingSpec): string {
    return spec.version === null ? spec.name : `${spec.name}@${spec.version}`;
}

function nameOf(spec: ReadingSpec): string {
    return (spec.folder === '' ? spec.name : spec.folder).split('/').pop() ?? spec.name;
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
