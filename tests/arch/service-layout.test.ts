import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE_ROOTS = [
    'packages/contracts/src',
    'packages/persistence/src',
    'apps/collector/src',
    'apps/gateway/src',
    'apps/viewer/src',
];

function listSourceFiles(): string[] {
    const files: string[] = [];

    function walk(directory: string): void {
        for (const entry of readdirSync(directory)) {
            const absolutePath = join(directory, entry);
            if (statSync(absolutePath).isDirectory()) {
                walk(absolutePath);
            } else if (/\.tsx?$/.test(entry)) {
                files.push(absolutePath);
            }
        }
    }

    for (const sourceRoot of SOURCE_ROOTS) {
        walk(join(REPOSITORY_ROOT, sourceRoot));
    }
    return files;
}

const sourceFiles = listSourceFiles();

function readFilesImporting(packageName: string): string[] {
    const pattern = new RegExp(`from '${packageName}'|from "${packageName}"`);
    return sourceFiles
        .filter((absolutePath) => pattern.test(readFileSync(absolutePath, 'utf8')))
        .map((absolutePath) => relative(REPOSITORY_ROOT, absolutePath));
}

describe('service layout', () => {
    it('finds services to check', () => {
        const serviceFiles = sourceFiles.filter((path) => basename(path).endsWith('-service.ts'));

        expect(serviceFiles.length).toBeGreaterThan(0);
    });

    it('keeps every service at services/<domain>/<domain>-service.ts', () => {
        const misplaced = sourceFiles
            .filter((path) => basename(path).endsWith('-service.ts'))
            .filter((path) => basename(path) !== `${basename(dirname(path))}-service.ts`)
            .map((path) => relative(REPOSITORY_ROOT, path));

        expect(misplaced).toEqual([]);
    });

    it('keeps every service inside a services directory', () => {
        const looseServices = sourceFiles
            .filter((path) => basename(path).endsWith('-service.ts'))
            .filter((path) => !dirname(dirname(path)).endsWith('services'))
            .map((path) => relative(REPOSITORY_ROOT, path));

        expect(looseServices).toEqual([]);
    });
});

describe('third-party containment', () => {
    it('imports the PostgreSQL driver only inside its own service', () => {
        expect(readFilesImporting('pg')).toEqual([
            'packages/persistence/src/services/postgres/postgres-service.ts',
        ]);
    });

    it('imports the websocket client only inside the venue feed service', () => {
        expect(readFilesImporting('ws')).toEqual([
            'apps/collector/src/services/binance-depth-feed/binance-depth-feed-service.ts',
        ]);
    });

    it('reaches the venue over HTTP only from the venue feed service', () => {
        const callers = sourceFiles
            .filter((path) => /\bfapi\.binance\.com|fstream\.binance\.com/.test(readFileSync(path, 'utf8')))
            .map((path) => relative(REPOSITORY_ROOT, path));

        expect(callers).toEqual(['apps/collector/src/configuration/collector-configuration.ts']);
    });
});

describe('type safety', () => {
    it('never falls back to the any type in production code', () => {
        const offenders = sourceFiles
            .filter((path) => /:\s*any\b|<any>|as any\b/.test(readFileSync(path, 'utf8')))
            .map((path) => relative(REPOSITORY_ROOT, path));

        expect(offenders).toEqual([]);
    });

    it('never leaves a bare TODO behind', () => {
        const offenders = sourceFiles
            .filter((path) => /TODO(?!\()/.test(readFileSync(path, 'utf8')))
            .map((path) => relative(REPOSITORY_ROOT, path));

        expect(offenders).toEqual([]);
    });
});
