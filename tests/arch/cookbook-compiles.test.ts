import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ADDON_SURFACE_TYPES } from '../../src/app/addons/addon-surface.generated.ts';

const ROOT = join(import.meta.dirname, '../..');
const COOKBOOK = join(ROOT, 'docs', 'en', 'connector-cookbook.md');

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

describe('the connector cookbook', () => {
    it('has recipes in it', () => {
        // A page whose blocks stopped being found would pass every check below
        // by having nothing to check.
        const blocks = blocksIn(COOKBOOK);

        expect(blocks.filter((block) => IS_WHOLE.test(block)).length).toBeGreaterThanOrEqual(3);
        expect(blocks.length).toBeGreaterThan(blocks.filter((block) => IS_WHOLE.test(block)).length);
    });

    it('compiles every whole connector on the page', () => {
        // The page is what a reader copies. A recipe that stopped compiling is
        // an hour of somebody else's evening.
        const refused = blocksIn(COOKBOOK)
            .filter((block) => IS_WHOLE.test(block))
            .map((block, index) => ({ index, said: typecheck(block) }))
            .filter((one) => one.said !== '');

        expect(refused.map((one) => `recipe ${String(one.index)}: ${one.said}`)).toEqual([]);
    }, 120_000);

    it('still catches a recipe that stopped agreeing with the surface', () => {
        const whole = blocksIn(COOKBOOK).find((block) => IS_WHOLE.test(block))!;

        expect(typecheck(whole.replace('readonly instruments = {', 'readonly instrument = {'))).not.toBe('');
    }, 60_000);
});
