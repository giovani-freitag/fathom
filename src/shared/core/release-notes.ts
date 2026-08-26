export interface ReleaseChange {
    /** What the change was filed under, such as `Bug Fixes`. */
    readonly heading: string;
    readonly entries: readonly string[];
}

export interface ReleaseNotes {
    readonly version: string;
    /** The day it was cut, as written in the changelog. */
    readonly releasedOn: string;
    readonly changes: readonly ReleaseChange[];
}

// The version may be linked or bare; the date is the last parenthesised group,
// because a linked version puts a URL in parentheses of its own before it.
const VERSION_HEADING = /^## \[?([^\]\s(]+)\]?.*\(([^)]*)\)\s*$/;
const SECTION_HEADING = /^### (.+?)\s*$/;
const ENTRY = /^\* (.+?)\s*$/;
/** The commit link every generated entry ends with, which says nothing to a reader. */
const TRAILING_LINK = /\s*\(\[[0-9a-f]+\]\([^)]*\)\)\s*$/;

/**
 * Reads the most recent release out of a generated changelog.
 *
 * @param markdown - The whole changelog file.
 * @returns The newest release, or null when the file names none yet.
 */
export function parseLatestRelease(markdown: string): ReleaseNotes | null {
    const lines = markdown.split('\n');
    const start = lines.findIndex((line) => VERSION_HEADING.test(line));
    if (start === -1) {
        return null;
    }

    const [, version, releasedOn] = VERSION_HEADING.exec(lines[start]!)!;
    const changes: ReleaseChange[] = [];

    for (const line of lines.slice(start + 1)) {
        // The next version heading ends this release; everything below it was
        // already read by whoever was looking at that release.
        if (VERSION_HEADING.test(line)) {
            break;
        }
        const heading = SECTION_HEADING.exec(line);
        if (heading !== null) {
            changes.push({ heading: heading[1]!, entries: [] });
            continue;
        }
        const entry = ENTRY.exec(line);
        if (entry !== null && changes.length > 0) {
            const section = changes[changes.length - 1]!;
            (section.entries as string[]).push(entry[1]!.replace(TRAILING_LINK, ''));
        }
    }

    return { version: version!, releasedOn: releasedOn!, changes };
}
