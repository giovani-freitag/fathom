import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Every source file, wherever in the tree it sits. */
function listSources(root: string): string[] {
    return readdirSync(root).flatMap((entry) => {
        const path = join(root, entry);
        if (statSync(path).isDirectory()) {
            return listSources(path);
        }
        return /\.tsx?$/.test(entry) ? [path] : [];
    });
}

const SOURCES = listSources(join(ROOT, 'src'));
const MIGRATIONS = join(ROOT, 'database', 'migrations');

/** Files whose text matches, named relative to the repository. */
function filesMatching(pattern: RegExp): string[] {
    return SOURCES
        .filter((path) => pattern.test(readFileSync(path, 'utf8')))
        .map((path) => path.slice(ROOT.length + 1));
}

describe('the one store the recording lives in', () => {
    it('is never chosen between, because there is nothing to choose', () => {
        // Two stores were kept side by side while one was being proved against
        // the other, and every layer that touched the book grew a way to name
        // which one it meant — a query parameter, a socket field, a constant, a
        // map of tails. Each round of taking them out left one of those behind,
        // and a name with one store behind it reads like a choice that is
        // simply not offered yet.
        //
        // Matched on the shapes it actually came back as, not on the word:
        // `frames` also names one of the two bodies a window holds, against
        // the executions, and that is a different distinction about a
        // different thing.
        expect(filesMatching(
            /\bFrameSource\b|sourcesByName|\bDRAWN_FROM\b|Type\.Literal\('frames'\)/,
        )).toEqual([]);
    });

    it('is never read out of a table of one row per instant', () => {
        // What the recording was before it was squares. Every instant it held
        // was written into the archive and checked against it column by column
        // before it went, and nothing may reach for it again.
        expect(filesMatching(/\bliquidity_frame\b(?!')/)).toEqual([]);
    });

    it('is never written a row at a time either', () => {
        // Named for the write rather than for the word: the chart appends
        // drawn columns to what it is holding, and that is a different verb
        // about a different thing entirely.
        expect(filesMatching(/INSERT INTO liquidity_frame|createObjectStore\(STORES\.liquidityFrame/))
            .toEqual([]);
    });

    it('is the only place a migration builds the book', () => {
        // A migration that recreates the table would put it back on every run,
        // because these are re-applied in order and keep no ledger.
        const built = readdirSync(MIGRATIONS)
            .filter((name) => name.endsWith('.sql'))
            .filter((name) => /CREATE TABLE[^;]*liquidity_frame/i
                .test(readFileSync(join(MIGRATIONS, name), 'utf8')));

        expect(built).toEqual([]);
    });
});
