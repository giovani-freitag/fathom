import { existsSync, readFileSync } from 'node:fs';
import { parseLatestRelease, type ReleaseNotes } from '../src/shared/core/release-notes.ts';

/** What the app is told about the build it is running. */
export interface ReleaseDefines {
    readonly __APP_VERSION__: string;
    readonly __RELEASE_NOTES__: string;
}

/**
 * Reads the version and the newest changelog entry for a bundle to carry.
 *
 * @returns The values to hand Vite's `define`, already JSON.
 */
export function readReleaseDefines(): ReleaseDefines {
    const manifest: { version?: string } = JSON.parse(readFileSync('package.json', 'utf8'));
    // Absent until the first release is cut, and on a fresh clone before one is.
    const notes: ReleaseNotes | null = existsSync('CHANGELOG.md')
        ? parseLatestRelease(readFileSync('CHANGELOG.md', 'utf8'))
        : null;

    return {
        __APP_VERSION__: JSON.stringify(manifest.version ?? '0.0.0'),
        __RELEASE_NOTES__: JSON.stringify(notes),
    };
}
