import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { CHART_LAYERS, findChartLayer } from '../../src/app/indicators/indicator-catalogue.ts';

const ROOT = join(import.meta.dirname, '../..');
const ADDONS = join('src', 'app', 'indicators');

/** Where a layer may be named from outside itself. */
const REGISTRIES = new Set([
    'indicator-catalogue.ts',
    'field-layers.ts',
    'layer-painters.ts',
    'layer-contributions.ts',
]);

/**
 * The two places outside that may still name a layer, and why.
 *
 * The preferences service reads documents written when the layers were arranged
 * differently, so the names in it are history rather than references.
 *
 * The dataset holds the recorded frames, and summarising what is in them is
 * done where they are held. That one is a seam, not a decision: the cuts it
 * takes exist only because the book paints a ramp with them.
 */
const MAY_NAME_A_LAYER = new Set([
    join('src', 'app', 'services', 'preferences-service.ts'),
    join('src', 'app', 'core', 'chart-dataset.ts'),
]);

function listSources(directory: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
            found.push(...listSources(path));
            continue;
        }
        if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
            found.push(path);
        }
    }
    return found;
}

function reachesIntoAnAddon(source: string): boolean {
    const text = readFileSync(source, 'utf8');
    return /from\s+'[^']*indicators\/[^'/]+\/[^']+'/.test(text);
}

/**
 * The addon folders a file reaches into other than its own.
 *
 * Resolved rather than matched: a specifier that climbs out of indicators/
 * entirely is reaching the host, which is a different question.
 */
function listOtherFoldersReached(source: string): string[] {
    const own = source.split('/')[0]!;
    const text = readFileSync(join(ROOT, ADDONS, source), 'utf8');
    const reached: string[] = [];

    for (const match of text.matchAll(/from\s+'(\.[^']+)'/g)) {
        const landed = relative(join(ROOT, ADDONS), resolve(join(ROOT, ADDONS, source, '..'), match[1]!));
        if (landed.startsWith('..') || !landed.includes('/')) {
            continue;
        }
        const folder = landed.split('/')[0]!;
        if (folder !== own && folder !== 'shared') {
            reached.push(folder);
        }
    }
    return reached;
}

describe('addon isolation', () => {
    it('is reached only through a registry, never by naming one', () => {
        // A folder under indicators/ holds one layer whole: its arithmetic, what
        // paints it, and what it puts in the interface. Reaching past the
        // registries into one is how a layer stops being removable.
        const outside = listSources(join(ROOT, 'src', 'app'))
            .map((path) => relative(ROOT, path))
            .filter((path) => !path.startsWith(ADDONS))
            .filter((path) => !MAY_NAME_A_LAYER.has(path))
            .filter((path) => reachesIntoAnAddon(join(ROOT, path)));

        expect(outside).toEqual([]);
    });

    it('lets a layer reach only its own folder and the shared arithmetic', () => {
        // One layer must never read another's internals. Reaching the shared
        // arithmetic is fine: that is what it is for.
        const crossing = listSources(join(ROOT, ADDONS))
            .map((path) => relative(join(ROOT, ADDONS), path))
            .filter((path) => path.includes('/'))
            .filter((path) => listOtherFoldersReached(path).length > 0);

        expect(crossing).toEqual([]);
    });

    it('keeps every registry at the top, where the way in is one list', () => {
        const top = readdirSync(join(ROOT, ADDONS))
            .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'));

        expect(new Set(top)).toEqual(REGISTRIES);
    });
});

describe('who gets to claim a name', () => {
    it('is the registry alone, because a reading carrying its own could take one', () => {
        // Lookup is a find by id and stored settings are keyed on the same
        // string, so a second reading answering to `delta` would inherit the
        // first's settings, never be called, and say nothing about it.
        const claimants = listSources(join(ROOT, ADDONS))
            .filter((path) => /^\s*(readonly )?id\s*[=:]\s*'/m.test(readFileSync(path, 'utf8')))
            .map((path) => relative(ROOT, path));

        expect(claimants).toEqual([]);
    });

    it('hands each name out once', () => {
        const claimed = CHART_LAYERS.map((entry) => entry.id);

        expect(claimed).toEqual([...new Set(claimed)]);
    });

    it('resolves every name it handed out', () => {
        // An entry whose id finds nothing is a palette row that adds nothing.
        const unresolved = CHART_LAYERS.filter((entry) => findChartLayer(entry.id) !== entry.layer);

        expect(unresolved.map((entry) => entry.id)).toEqual([]);
    });
});
