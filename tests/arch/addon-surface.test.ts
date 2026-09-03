import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ADDON_SURFACE_TYPES } from '../../src/app/addons/addon-surface.generated.ts';

const ROOT = join(import.meta.dirname, '../..');
const GENERATED = join(ROOT, 'src', 'app', 'addons', 'addon-surface.generated.ts');

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
});
