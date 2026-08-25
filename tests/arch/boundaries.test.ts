import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Folders the browser bundle is allowed to reach. */
const BROWSER_REACHABLE = ['src/chart/', 'src/book/', 'src/trades/', 'src/recording/', 'src/api/'];

/** Folders that only ever run in Node. */
const SERVER_ONLY = ['src/archive/', 'src/venue/'];

/** Packages that must never end up in a browser bundle. */
const SERVER_PACKAGES = ['pg', 'ws', 'fastify', 'node:fs', 'node:path'];

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

function importsOf(path: string): string[] {
    return [...read(path).matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
}

/** Everything the browser entry can reach, followed transitively. */
function collectBrowserReachable(): Set<string> {
    const reached = new Set<string>();
    const queue = ['src/main-viewer.tsx'];

    while (queue.length > 0) {
        const current = queue.pop()!;
        if (reached.has(current)) {
            continue;
        }
        reached.add(current);

        for (const specifier of importsOf(current)) {
            if (!specifier.startsWith('.')) {
                continue;
            }
            const resolved = relative(ROOT, join(ROOT, current, '..', specifier)).replaceAll('\\', '/');
            if (/\.tsx?$/.test(resolved)) {
                queue.push(resolved);
            }
        }
    }
    return reached;
}

const browserReachable = collectBrowserReachable();

describe('the browser half', () => {
    it('reaches a meaningful part of the tree, so the check is exercised', () => {
        expect(browserReachable.size).toBeGreaterThan(20);
    });

    it('never pulls in a server-only package', () => {
        const offenders = [...browserReachable].filter(
            (path) => importsOf(path).some((specifier) => SERVER_PACKAGES.includes(specifier)),
        );

        expect(offenders).toEqual([]);
    });

    it('never reaches a server-only folder', () => {
        const offenders = [...browserReachable].filter(
            (path) => SERVER_ONLY.some((folder) => path.startsWith(folder)),
        );

        expect(offenders).toEqual([]);
    });

    it('stays inside the folders it is allowed to share', () => {
        const strays = [...browserReachable]
            .filter((path) => path.startsWith('src/'))
            .filter((path) => !BROWSER_REACHABLE.some((folder) => path.startsWith(folder)))
            .filter((path) => !['src/main-viewer.tsx', 'src/app.tsx'].includes(path));

        expect(strays).toEqual([]);
    });
});

describe('the server half', () => {
    it('keeps React out of everything it runs', () => {
        const offenders = sourceFiles
            .filter((path) => SERVER_ONLY.some((folder) => path.startsWith(folder)))
            .filter((path) => importsOf(path).some((specifier) => specifier.startsWith('react')));

        expect(offenders).toEqual([]);
    });

    it('imports the PostgreSQL driver only from the archive', () => {
        const strays = sourceFiles
            .filter((path) => importsOf(path).includes('pg'))
            .filter((path) => !path.startsWith('src/archive/'));

        expect(strays).toEqual([]);
    });

    it('imports the websocket client only from the venue and the api', () => {
        const strays = sourceFiles
            .filter((path) => importsOf(path).includes('ws'))
            .filter((path) => !path.startsWith('src/venue/') && !path.startsWith('src/api/'));

        expect(strays).toEqual([]);
    });

    it('reaches the venue over the network only from the venue folder', () => {
        const callers = sourceFiles.filter((path) => /binance\.com/.test(read(path)));

        expect(callers.every((path) => path.startsWith('src/venue/') || path.startsWith('src/recording/')))
            .toBe(true);
    });
});

describe('type safety', () => {
    it('never falls back to the any type', () => {
        const offenders = sourceFiles.filter((path) => /:\s*any\b|<any>|as any\b/.test(read(path)));

        expect(offenders).toEqual([]);
    });

    it('never leaves a bare TODO behind', () => {
        const offenders = sourceFiles.filter((path) => /TODO(?!\()/.test(read(path)));

        expect(offenders).toEqual([]);
    });
});
