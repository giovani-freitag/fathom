/// <reference types="vite/client" />

import type { ReleaseNotes } from '../shared/core/release-notes.ts';

declare global {
    /** The version this bundle was built from. */
    const __APP_VERSION__: string;

    /** The newest changelog entry, or null before the first release is cut. */
    const __RELEASE_NOTES__: ReleaseNotes | null;
}
