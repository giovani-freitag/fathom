import { describe, expect, it } from 'vitest';
import { parseLatestRelease } from '../../../src/shared/core/release-notes.ts';

const CHANGELOG = `# Changelog

## [0.1.1](https://github.com/o/r/compare/v0.1.0...v0.1.1) (2026-08-26)

### Bug Fixes

* close the log before exit ([bf96fa8](https://github.com/o/r/commit/bf96fa8))
* replace a collector that stops ([18175f2](https://github.com/o/r/commit/18175f2))

### Features

* add a light theme ([7bcc219](https://github.com/o/r/commit/7bcc219))

## [0.1.0](https://github.com/o/r/compare/v0.0.9...v0.1.0) (2026-08-24)

### Features

* the first one ([0000000](https://github.com/o/r/commit/0000000))
`;

describe('parseLatestRelease', () => {
    it('reads the version and the day it was cut', () => {
        expect(parseLatestRelease(CHANGELOG)).toMatchObject({
            version: '0.1.1',
            releasedOn: '2026-08-26',
        });
    });

    it('groups the entries under the heading they were filed against', () => {
        const notes = parseLatestRelease(CHANGELOG)!;

        expect(notes.changes.map((change) => change.heading)).toEqual(['Bug Fixes', 'Features']);
        expect(notes.changes[0]!.entries).toHaveLength(2);
    });

    it('drops the commit link, which says nothing to a reader', () => {
        const notes = parseLatestRelease(CHANGELOG)!;

        expect(notes.changes[0]!.entries[0]).toBe('close the log before exit');
    });

    it('stops at the release before it', () => {
        const notes = parseLatestRelease(CHANGELOG)!;

        expect(notes.changes.flatMap((change) => change.entries)).not.toContain('the first one');
    });

    it('answers null for a changelog that names no release yet', () => {
        expect(parseLatestRelease('# Changelog\n')).toBeNull();
    });
});
