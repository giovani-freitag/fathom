#!/usr/bin/env node
/**
 * Bundles the addon surface into the one JavaScript file a repository can run.
 *
 * The package beside this has always shipped `fathom.d.ts`, which is enough to
 * typecheck an addon and not enough to test one: the surface exports values as
 * well as types — `Plot`, `Params`, `inWords`, and now the `Connector` a
 * connector extends — and an addon that imports one of those cannot be loaded
 * outside Fathom's own in-page linker.
 *
 * One file, no dependencies, ESM. The in-page linker still hands over the live
 * modules; this is for the repository that keeps an addon and wants to run its
 * tests against the real thing rather than against a copy of it.
 */
import { build } from 'rolldown';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACE = join(ROOT, 'src', 'shared', 'core', 'addon-api.ts');
const OUT = join(ROOT, 'packages', 'types', 'fathom.js');

const bundled = await build({
    input: SURFACE,
    output: { file: OUT, format: 'esm', sourcemap: false },
    // Nothing outside the surface's own graph may come along. A surface that
    // pulled a dependency in would make an addon repository install it too.
    external: [],
    platform: 'neutral',
    resolve: { extensions: ['.ts'] },
});

const written = bundled.output.find((one) => one.type === 'chunk');
console.log(`Wrote ${OUT} (${String(written?.code.length ?? 0)} characters of surface)`);
