/** The files one reading is written across, keyed by path within it. */
export type ReadingFiles = Readonly<Record<string, string>>;

/** The file the chart takes the reading out of. */
export const ENTRY_FILE = 'main.ts';

/** What a path may be made of, so it cannot climb out of the reading. */
const LEGAL_PATH = /^(?!\/)(?!.*\/\/)(?!.*(^|\/)\.\.?(\/|$))[\w.\-/]+\.tsx?$/;

/** The endings tried for a specifier written without one. */
const ENDINGS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/**
 * Whether a path may name a file inside a reading.
 *
 * @param path - What the reader typed, or what a stored reading claims.
 * @returns Whether it is a plain relative path ending in `.ts` or `.tsx`.
 */
export function isLegalPath(path: string): boolean {
    return LEGAL_PATH.test(path);
}

/**
 * The path a specifier written inside one file points at.
 *
 * @param specifier - What the script imported, as written.
 * @param from - The path of the file that imported it.
 * @param files - Every path in the reading, to settle a missing ending.
 * @returns The path within the reading, or null where nothing is there.
 */
export function resolveWithin(
    specifier: string,
    from: string,
    files: Iterable<string>,
): string | null {
    const held = new Set(files);
    const parts = from.split('/').slice(0, -1);

    for (const step of specifier.split('/')) {
        if (step === '..') {
            if (parts.pop() === undefined) {
                return null;
            }
        } else if (step !== '.' && step !== '') {
            parts.push(step);
        }
    }

    const joined = parts.join('/');
    return ENDINGS.map((ending) => `${joined}${ending}`).find((path) => held.has(path)) ?? null;
}

/** Whether a specifier points inside the reading rather than at the surface. */
export function isWithin(specifier: string): boolean {
    return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * The folder a path sits in, empty at the top of the reading.
 *
 * @param path - The file's path within the reading.
 * @returns Everything before the last separator.
 */
export function folderOf(path: string): string {
    const cut = path.lastIndexOf('/');
    return cut === -1 ? '' : path.slice(0, cut);
}
