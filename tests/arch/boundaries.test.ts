import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * What each runtime is allowed to reach.
 *
 * The top of the tree answers "who executes this", so a forbidden import is a
 * folder crossing rather than a package that happens to be installed. These
 * lists are the whole architecture: everything else is detail.
 */
const REACHABLE: Record<string, readonly string[]> = {
    'src/shared': ['src/shared'],
    'src/database': ['src/database', 'src/shared'],
    'src/server': ['src/server', 'src/database', 'src/shared'],
    'src/workers': ['src/workers', 'src/database', 'src/shared'],
    'src/app': ['src/app', 'src/shared'],
};

/** Packages that belong to exactly one runtime. */
const CONFINED_PACKAGES: Record<string, string> = {
    pg: 'src/database',
    ws: 'src/workers',
    fastify: 'src/server',
    react: 'src/app',
    'react-dom': 'src/app',
    'radix-ui': 'src/app',
};

function listFiles(directory: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(join(ROOT, directory))) {
        const relativePath = `${directory}/${entry}`;
        if (statSync(join(ROOT, relativePath)).isDirectory()) {
            found.push(...listFiles(relativePath));
        } else if (/\.tsx?$/.test(entry)) {
            found.push(relativePath);
        }
    }
    return found;
}

const sourceFiles = listFiles('src');

function read(path: string): string {
    return readFileSync(join(ROOT, path), 'utf8');
}

function specifiersOf(path: string): string[] {
    return [...read(path).matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
}

/** Where a relative specifier lands, as a repository path. */
function resolveWithin(path: string, specifier: string): string {
    const parts = path.split('/').slice(0, -1);
    for (const step of specifier.split('/')) {
        if (step === '..') {
            parts.pop();
        } else if (step !== '.') {
            parts.push(step);
        }
    }
    return parts.join('/');
}

function runtimeOf(path: string): string | undefined {
    return Object.keys(REACHABLE).find((runtime) => path.startsWith(`${runtime}/`));
}

describe('runtime boundaries', () => {
    it('covers every source file, so nothing escapes the rules', () => {
        const unclaimed = sourceFiles.filter((path) => runtimeOf(path) === undefined);

        expect(unclaimed).toEqual([]);
    });

    for (const [runtime, allowed] of Object.entries(REACHABLE)) {
        it(`${runtime} reaches only ${allowed.join(', ')}`, () => {
            const crossings = sourceFiles
                .filter((path) => path.startsWith(`${runtime}/`))
                .flatMap((path) => specifiersOf(path)
                    .filter((specifier) => specifier.startsWith('.'))
                    .map((specifier) => resolveWithin(path, specifier))
                    .filter((target) => target.startsWith('src/'))
                    .filter((target) => !allowed.some((folder) => target.startsWith(`${folder}/`)))
                    .map((target) => `${path} → ${target}`));

            expect(crossings).toEqual([]);
        });
    }
});

describe('package confinement', () => {
    for (const [packageName, runtime] of Object.entries(CONFINED_PACKAGES)) {
        it(`imports ${packageName} only from ${runtime}`, () => {
            const strays = sourceFiles
                .filter((path) => specifiersOf(path).some(
                    (specifier) => specifier === packageName || specifier.startsWith(`${packageName}/`),
                ))
                .filter((path) => !path.startsWith(`${runtime}/`));

            expect(strays).toEqual([]);
        });
    }

    it('reaches the venue over the network only from the workers', () => {
        const callers = sourceFiles.filter((path) => /binance\.com/.test(read(path)));

        expect(callers.every((path) => path.startsWith('src/workers/'))).toBe(true);
    });
});

describe('type safety', () => {
    it('never falls back to the any type', () => {
        expect(sourceFiles.filter((path) => /:\s*any\b|<any>|as any\b/.test(read(path)))).toEqual([]);
    });

    it('never leaves a bare TODO behind', () => {
        expect(sourceFiles.filter((path) => /TODO(?!\()/.test(read(path)))).toEqual([]);
    });
});
