import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ADDON_SURFACE_TYPES } from '../../src/app/addons/addon-surface.generated.ts';

const ROOT = join(import.meta.dirname, '../..');
/** Both translations, because the code on them is the same code. */
const COOKBOOKS = ['en', 'pt-BR'].map((language) =>
    join(ROOT, 'docs', language, 'connector-cookbook.md'));

/** A whole connector begins by importing the base class. */
const IS_WHOLE = /^import \{ Connector \}/m;

/**
 * Every fenced TypeScript block in a page, in the order it is read.
 *
 * @param path - The page to read.
 * @returns Each block's source.
 */
function blocksIn(path: string): readonly string[] {
    const page = readFileSync(path, 'utf8');
    return [...page.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((found) => found[1]!);
}

/**
 * Compiles one source against the surface alone, as the in-page editor does.
 *
 * @param source - The block, as written on the page.
 * @returns What the compiler said, empty where it said nothing.
 */
function typecheck(source: string): string {
    const staging = mkdtempSync(join(tmpdir(), 'fathom-cookbook-'));
    try {
        writeFileSync(join(staging, 'fathom.d.ts'), ADDON_SURFACE_TYPES);
        writeFileSync(join(staging, 'addon.ts'), source);
        writeFileSync(join(staging, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                target: 'ES2024',
                module: 'esnext',
                moduleResolution: 'bundler',
                strict: true,
                noUncheckedIndexedAccess: true,
                noEmit: true,
                skipLibCheck: true,
                lib: ['ES2024', 'DOM'],
            },
            files: ['fathom.d.ts', 'addon.ts'],
        }));
        execFileSync('npx', ['tsc', '-p', staging], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
        return '';
    } catch (error) {
        return String((error as { stdout?: string }).stdout ?? error);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
}

describe.each(COOKBOOKS)('the connector cookbook at %s', (cookbook) => {
    it('has recipes in it', () => {
        // A page whose blocks stopped being found would pass every check below
        // by having nothing to check.
        const blocks = blocksIn(cookbook);

        expect(blocks.filter((block) => IS_WHOLE.test(block)).length).toBeGreaterThanOrEqual(3);
        expect(blocks.length).toBeGreaterThan(blocks.filter((block) => IS_WHOLE.test(block)).length);
    });

    it('compiles every whole connector on the page', () => {
        // The page is what a reader copies. A recipe that stopped compiling is
        // an hour of somebody else's evening — and a translation nobody
        // compiles is where that hour actually gets spent.
        const refused = blocksIn(cookbook)
            .filter((block) => IS_WHOLE.test(block))
            .map((block, index) => ({ index, said: typecheck(block) }))
            .filter((one) => one.said !== '');

        expect(refused.map((one) => `recipe ${String(one.index)}: ${one.said}`)).toEqual([]);
    }, 120_000);

    it('still catches a recipe that stopped agreeing with the surface', () => {
        const whole = blocksIn(cookbook).find((block) => IS_WHOLE.test(block))!;

        // Renamed by one letter, which is what a rename in the surface looks
        // like from the page's side: the method the base class asks for is
        // suddenly unwritten.
        expect(typecheck(whole.replace('planInstruments()', 'planInstrument()'))).not.toBe('');
    }, 60_000);
});
