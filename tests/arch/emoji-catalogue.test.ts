import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EMOJI_CATALOGUE, EMOJI_GROUPS } from '../../src/shared/core/emoji-catalogue.generated.ts';

const ROOT = join(import.meta.dirname, '../..');
const GENERATED = join(ROOT, 'src', 'shared', 'core', 'emoji-catalogue.generated.ts');

describe('the emoji a reader can pin', () => {
    it('have not drifted from the package they were generated out of', () => {
        // Committed rather than built on demand, so a fresh clone needs no
        // extra step. This is what stops the committed copy going stale.
        const staging = mkdtempSync(join(tmpdir(), 'fathom-emoji-'));
        const beside = join(staging, 'emoji-catalogue.generated.ts');

        execFileSync('node', ['scripts/build-emoji-catalogue.mjs', beside], { cwd: ROOT, stdio: 'pipe' });

        expect(readFileSync(beside, 'utf8')).toBe(readFileSync(GENERATED, 'utf8'));
        rmSync(staging, { recursive: true, force: true });
    }, 30_000);

    it('are every one of them findable by a word somebody would type', () => {
        // The search reads this column and nothing else, so an emoji with an
        // empty one is in the catalogue and reachable only by scrolling to it.
        const unfindable = EMOJI_CATALOGUE.filter(([, , terms]) => terms.trim() === '');

        expect(unfindable).toEqual([]);
    });

    it('each sit in a group the picker has a tab for', () => {
        // A group with no tab is a set of emoji the picker holds and never
        // shows, which reads to a reader as the catalogue being incomplete.
        const orphaned = EMOJI_CATALOGUE
            .filter(([, , , group]) => !EMOJI_GROUPS.includes(group as (typeof EMOJI_GROUPS)[number]));

        expect(orphaned).toEqual([]);
    });
});
