import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function read(path: string): string {
    return readFileSync(new URL(path, new URL('file://' + ROOT + '/')), 'utf8');
}

/** The store names a route offers, taken from its literal union. */
function offeredStores(source: string): string[] {
    const union = /source:\s*Type\.Optional\(Type\.Union\(\[([\s\S]*?)\]\)\)/.exec(source);
    return [...(union?.[1] ?? '').matchAll(/Type\.Literal\('([^']+)'\)/g)].map((one) => one[1]!);
}

/** The store names the gateway wired a live tail for. */
function streamableStores(main: string): string[] {
    const block = /sourcesByName:\s*\{([\s\S]*?)\n {4}\},/.exec(main);
    return [...(block?.[1] ?? '').matchAll(/^ {8}(\w+):/gm)].map((one) => one[1]!);
}

describe('the stores a reader can choose between', () => {
    const heatmap = read('src/server/http/schemas/heatmap-schema.ts');
    const live = read('src/server/http/schemas/live-schema.ts');
    const main = read('src/server/main.ts');

    it('offers the same names for history and for the live tail', () => {
        // These stores exist to be weighed against each other. One a reader can
        // ask history for but not be streamed is one they would watch stand
        // still, or — worse — be quietly served from somewhere else.
        expect(offeredStores(live).sort()).toEqual(offeredStores(heatmap).sort());
    });

    it('wires a live tail for every name it offers', () => {
        // The class of mistake this catches was made once already: two of the
        // five names had no tail behind them, so a chart drawn from one store
        // was fed from another and the comparison measured nothing.
        expect(offeredStores(live).filter((name) => !streamableStores(main).includes(name)))
            .toEqual([]);
    });

    it('finds the names at all, so a rename cannot empty this check', () => {
        expect(offeredStores(heatmap).length).toBeGreaterThan(1);
        expect(streamableStores(main).length).toBeGreaterThan(1);
    });
});
