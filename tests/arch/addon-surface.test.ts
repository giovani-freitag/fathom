import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ADDON_SURFACE_TYPES } from '../../src/app/addons/addon-surface.generated.ts';

const ROOT = join(import.meta.dirname, '../..');
const GENERATED = join(ROOT, 'src', 'app', 'addons', 'addon-surface.generated.ts');

/** What a repository of readings resolves `'fathom'` to, by depending on the package. */
const PUBLISHED = join(ROOT, 'packages', 'types', 'fathom.d.ts');
const PUBLISHED_RUNTIME = join(ROOT, 'packages', 'types', 'fathom.js');

/**
 * An addon written the way the cookbook says to write one.
 *
 * Deliberately uses each half of the surface — the interface, the knobs, the
 * plot builder and the reads — so that dropping any of them fails here.
 */
const PROBE = `
import {
    Params,
    Plot,
    readSessions,
    readSetting,
    type Indicator,
    type IndicatorInput,
    type IndicatorSettings,
    type PlanDraft,
    type SourceRequest,
} from 'fathom';

const PERIOD = Params.integer('periodBars').called('Period').between(2, 400).startingAt(20);
const DAY_MS = 86_400_000;

export default class Mine implements Indicator {
    readonly label = 'My reading';
    readonly about = 'What it says about the market';
    readonly parameters = [PERIOD];

    resolveSources(settings: IndicatorSettings): SourceRequest {
        return {
            warmupBars: readSetting(settings, PERIOD),
            sessions: { daily: { intervalMs: DAY_MS, reachingBack: 2 } },
        };
    }

    compute(input: IndicatorInput): PlanDraft {
        const daily = readSessions(input, 'daily');
        const values = input.bars.bars.map((bar, index) => (
            daily.perBar[index] === undefined ? Number.NaN : bar.closePrice
        ));

        return Plot.over(input.bars)
            .line(values, 'Mine')
            .in('amber')
            .overThePrice();
    }
}
`;

/** Compiles a source file against the surface alone, as the editor does. */
function typecheckAgainstSurface(source: string): string {
    const staging = mkdtempSync(join(tmpdir(), 'fathom-surface-'));
    try {
        writeFileSync(join(staging, 'fathom.d.ts'), ADDON_SURFACE_TYPES);
        writeFileSync(join(staging, 'addon.ts'), source);
        writeFileSync(join(staging, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                target: 'ES2024',
                module: 'esnext',
                moduleResolution: 'bundler',
                strict: true,
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

describe('the types the in-page editor is given', () => {
    it('are what an addon written against them compiles with', () => {
        // The editor's autocomplete is only worth having if it agrees with what
        // actually runs, and the two are generated from the same source.
        expect(typecheckAgainstSurface(PROBE)).toBe('');
    }, 60_000);

    it('reject a reading that returns something that is not a plan', () => {
        const wrong = PROBE.replace(
            '            .overThePrice();',
            '            .overThePrice().series;',
        );

        expect(typecheckAgainstSurface(wrong)).not.toBe('');
    }, 60_000);

    it('have not drifted from the surface they were generated out of', () => {
        // Committed rather than built on demand, so a fresh clone needs no
        // extra step. This is what stops the committed copy going stale.
        const staging = mkdtempSync(join(tmpdir(), 'fathom-drift-'));
        const beside = join(staging, 'addon-surface.generated.ts');

        execFileSync('node', ['scripts/build-addon-types.mjs', beside], { cwd: ROOT, stdio: 'pipe' });

        expect(readFileSync(beside, 'utf8')).toBe(readFileSync(GENERATED, 'utf8'));
        rmSync(staging, { recursive: true, force: true });
    }, 60_000);

    it('are the same surface a repository of readings depends on', () => {
        // The package's own types, which anything depending on this repository
        // resolves `import … from 'fathom'` to. Generated from the same barrel
        // as the editor's copy, so the two cannot say different things.
        const staging = mkdtempSync(join(tmpdir(), 'fathom-drift-'));
        const beside = join(staging, 'fathom.d.ts');

        execFileSync('node', ['scripts/build-addon-types.mjs', '--dts', beside], { cwd: ROOT, stdio: 'pipe' });

        expect(readFileSync(beside, 'utf8')).toBe(readFileSync(PUBLISHED, 'utf8'));
        rmSync(staging, { recursive: true, force: true });
    }, 60_000);
});

describe('the values an addon imports', () => {
    it('are published beside the types, so a repository can run what it typechecks', async () => {
        // Types alone are enough to compile an addon and not enough to test
        // one: the surface exports values too, and an addon that imports the
        // `Connector` it extends cannot be loaded outside Fathom without them.
        const surface = await import(pathToFileURL(PUBLISHED_RUNTIME).href) as Record<string, unknown>;

        expect(typeof surface['Connector']).toBe('function');
        expect(typeof surface['Plot']).toBe('object');
        expect(typeof surface['Params']).toBe('object');
        expect(typeof surface['inWords']).toBe('function');
    });

    it('carry every value the surface declares, and no fewer', () => {
        // Read off the barrel rather than listed here: a value added to the
        // surface and left out of the bundle is an import that typechecks and
        // throws.
        const barrel = readFileSync(join(ROOT, 'src', 'shared', 'core', 'addon-api.ts'), 'utf8');
        const exported = [...barrel.matchAll(/^export \{([^}]*)\}/gm)]
            .flatMap((found) => found[1]!.split(','))
            .map((one) => one.trim())
            .filter((one) => one !== '' && !one.startsWith('type '));
        const declared = [...barrel.matchAll(/^export const (\w+)/gm)].map((found) => found[1]!);

        const bundled = readFileSync(PUBLISHED_RUNTIME, 'utf8');
        const missing = [...exported, ...declared]
            .filter((name) => !new RegExp(`\\b${name}\\b`).test(bundled));

        expect(missing).toEqual([]);
    });
});
