import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

/**
 * Licences a shipped dependency may carry.
 *
 * Every one of these asks only that its own text travels with copies of itself.
 * None of them asks a reader of this chart to display anybody's name.
 */
const PERMITTED = new Set([
    'MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0', 'Unlicense', 'CC0-1.0',
]);

interface DependencyNode {
    readonly dependencies?: Readonly<Record<string, DependencyNode>>;
}

/**
 * Every package that ships, transitives included.
 *
 * Development tooling is left out on purpose: a bundler under a licence with
 * conditions attached puts no condition on the thing it built.
 */
function listShippedPackages(): string[] {
    const printed = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
    });

    const found = new Set<string>();
    const visit = (node: DependencyNode): void => {
        for (const [name, child] of Object.entries(node.dependencies ?? {})) {
            found.add(name);
            visit(child);
        }
    };
    visit(JSON.parse(printed) as DependencyNode);
    return [...found];
}

function readLicence(name: string): string | null {
    const manifest = join(ROOT, 'node_modules', name, 'package.json');
    if (!existsSync(manifest)) {
        // An optional dependency nobody installed ships nothing.
        return null;
    }
    // Old packages spell it as an object with a `type`; everything since spells
    // it as an SPDX string.
    const declared = (JSON.parse(readFileSync(manifest, 'utf8')) as {
        license?: string | { type?: string };
    }).license;
    if (typeof declared === 'string') {
        return declared;
    }
    return declared?.type ?? 'unknown';
}

describe('what this chart asks of the people it is given to', () => {
    it('is given away under the most permissive licence there is', () => {
        const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { license?: string };

        expect(manifest.license).toBe('MIT');
        expect(readFileSync(join(ROOT, 'LICENSE'), 'utf8')).toContain('MIT License');
    });

    it('ships nothing that carries conditions of its own', () => {
        // A chart offered as an alternative to a hosted one, that then makes
        // every reader of it display that host's name, is not an alternative.
        const refused = listShippedPackages()
            .map((name) => ({ name, licence: readLicence(name) }))
            .filter((entry) => entry.licence !== null && !PERMITTED.has(entry.licence))
            .map((entry) => `${entry.name} (${entry.licence ?? '?'})`);

        expect(refused).toEqual([]);
    });

    it('ships nothing that demands attribution be passed on', () => {
        // The trap is not the licence name but the NOTICE beside it: Apache-2.0
        // makes a NOTICE file's contents travel with every redistribution, and
        // that is how a logo ends up on somebody else's chart.
        const carrying = listShippedPackages().filter((name) => (
            existsSync(join(ROOT, 'node_modules', name, 'NOTICE'))
            || existsSync(join(ROOT, 'node_modules', name, 'NOTICE.txt'))
            || existsSync(join(ROOT, 'node_modules', name, 'NOTICE.md'))
        ));

        expect(carrying).toEqual([]);
    });
});
