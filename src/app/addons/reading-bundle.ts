import { ENTRY_FILE, isLegalPath, type ReadingFiles } from '../../shared/core/reading-files.ts';

/** What was in an exported bundle, or why it was not opened. */
export type BundleReading =
    | { readonly kind: 'read'; readonly name: string | null; readonly files: ReadingFiles }
    /** Not one of ours, or missing the file a reading is taken out of. */
    | { readonly kind: 'notOurs' }
    /** Ours, but holding a path that could name a file outside the reading. */
    | { readonly kind: 'illegalPath'; readonly path: string };

/**
 * A reading out of an exported bundle.
 *
 * Refused whole over one bad path rather than opened without it. A bundle is
 * written by the export and read by the editor, so a path the editor would not
 * accept means the file was edited by hand or by somebody else — and dropping
 * it quietly left the reader with a reading whose imports pointed at nothing
 * and no word about which file had gone.
 *
 * @param text - What was in the file.
 * @returns The reading, or which of the two ways it failed.
 */
export function readBundle(text: string): BundleReading {
    let parsed: { fathom?: unknown; name?: unknown; files?: unknown };
    try {
        parsed = JSON.parse(text) as typeof parsed;
    } catch {
        return { kind: 'notOurs' };
    }

    const files = parsed.files;
    if (parsed.fathom !== 1 || typeof files !== 'object' || files === null) {
        return { kind: 'notOurs' };
    }

    const held = Object.entries(files).filter(([, source]) => typeof source === 'string');
    const illegal = held.find(([path]) => !isLegalPath(path));
    if (illegal !== undefined) {
        return { kind: 'illegalPath', path: illegal[0] };
    }
    // An entry insisted on: a bundle is a file anybody can hand-edit, and one
    // with no `main.ts` left the editor showing a buffer nothing could see.
    if (!held.some(([path]) => path === ENTRY_FILE)) {
        return { kind: 'notOurs' };
    }

    return {
        kind: 'read',
        name: typeof parsed.name === 'string' ? parsed.name : null,
        files: Object.fromEntries(held),
    };
}
