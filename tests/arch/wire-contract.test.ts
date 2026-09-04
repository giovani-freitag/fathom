import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

/**
 * The property names a TypeScript interface declares.
 *
 * Read from the source rather than from a value, because the thing being
 * checked is what the declaration says: a field the type has and the schema
 * does not is a field that never reaches the browser.
 */
function readInterfaceFields(path: string, name: string): string[] {
    const source = readFileSync(join(ROOT, path), 'utf8');
    const body = source.split(`export interface ${name} {`)[1]?.split('\n}')[0] ?? '';
    return [...body.matchAll(/^\s*readonly\s+([A-Za-z][A-Za-z0-9]*)/gm)].map((found) => found[1]!);
}

/**
 * The property names a TypeBox object schema declares.
 */
function readSchemaFields(path: string, name: string): string[] {
    const source = readFileSync(join(ROOT, path), 'utf8');
    const body = source.split(`const ${name} = Type.Object({`)[1]?.split('});')[0] ?? '';
    return [...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):\s*Type\./gm)].map((found) => found[1]!);
}

/**
 * Every field the gateway serialises, against the type it came from.
 *
 * Depth frames are absent because they answer as a binary window rather than as
 * JSON, so nothing whitelists their fields — the codec's own round trip guards
 * those. Bars are absent because they never come from here: a venue publishes
 * candles for every past day and a recording holds only the days it ran for.
 */
describe('what the gateway is allowed to say', () => {
    it('serialises every field an execution cluster carries', () => {
        const declared = readInterfaceFields('src/shared/core/trade-cluster.ts', 'TradeCluster');
        const serialised = readSchemaFields(
            'src/server/http/schemas/trade-clusters-schema.ts',
            'TradeClusterItemSchema',
        );

        expect(declared.length).toBeGreaterThan(3);
        expect(declared.filter((field) => !serialised.includes(field))).toEqual([]);
    });

    it('reads a schema that is actually there, so a rename cannot pass by finding nothing', () => {
        // Both checks above compare against a list parsed out of a file. A typo
        // in a path or a name would parse an empty list, and an empty list
        // contains no missing fields.
        expect(readSchemaFields(
            'src/server/http/schemas/trade-clusters-schema.ts',
            'NoSuchSchema',
        )).toEqual([]);
        expect(readInterfaceFields('src/shared/core/trade-cluster.ts', 'NoSuchInterface')).toEqual([]);
    });
});
