#!/usr/bin/env node
/**
 * Emits the addon surface as declarations the in-page editor can read.
 *
 * Takes an output path, so a check can generate beside the committed copy
 * rather than over it. With `--dts` it writes the same declarations as a
 * package's own types instead — no `declare module` around them — which is what
 * a repository of readings gets by depending on this one.
 *
 * The editor has no filesystem and no package to resolve, so what it gets is
 * one module declaration holding every type reachable from the barrel. Run by
 * `npm run build:addon-types`, and checked by an arch test so it cannot drift
 * from the source it was generated out of.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACE = join(ROOT, 'src', 'shared', 'core', 'addon-api.ts');
const WANTS_DECLARATIONS = process.argv.includes('--dts');
const NAMED = process.argv.slice(2).find((one) => !one.startsWith('--'));
const OUT = NAMED ?? join(ROOT, 'src', 'app', 'addons', 'addon-surface.generated.ts');

/** The barrel is one file, so the emitted graph is small and ordered by name. */
function emitDeclarations() {
    const staging = mkdtempSync(join(tmpdir(), 'fathom-types-'));
    const config = join(staging, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({
        extends: join(ROOT, 'tsconfig.base.json'),
        compilerOptions: {
            noEmit: false,
            declaration: true,
            emitDeclarationOnly: true,
            rewriteRelativeImportExtensions: false,
            outDir: staging,
            rootDir: join(ROOT, 'src'),
            lib: ['ES2024', 'DOM'],
            types: [],
        },
        files: [SURFACE],
    }));

    execFileSync('npx', ['tsc', '-p', config], { cwd: ROOT, stdio: 'inherit' });
    return { staging, emitted: join(staging, 'shared', 'core') };
}

/** Where one top-level declaration begins in an emitted `.d.ts`. */
const DECLARATION_START = /^(\/\*\*|export|import|declare|type|interface|class)\b|^\/\*\*/;

/**
 * Every declaration in the graph, in the order it will be written out.
 *
 * @returns Each as its own block, so one can be dropped without disturbing
 *     the ones around it.
 */
function readBlocks(directory) {
    return readdirSync(directory)
        .filter((name) => name.endsWith('.d.ts'))
        .sort()
        .map((name) => ({ file: name, blocks: cutIntoBlocks(readFileSync(join(directory, name), 'utf8')) }));
}

function cutIntoBlocks(source) {
    const lines = source.split('\n')
        .filter((line) => !/^\s*(import|export)\s.*\sfrom\s/.test(line))
        .filter((line) => !/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(line));
    const blocks = [];
    let held = [];

    for (const line of lines) {
        if (held.length > 0 && DECLARATION_START.test(line)) {
            blocks.push(held);
            held = [];
        }
        held.push(line);
    }
    blocks.push(held);

    return blocks
        .map((block) => block.join('\n').replace(/\n{3,}/g, '\n\n').trim())
        .filter((block) => block !== '')
        .map((text) => ({ text, declares: nameDeclaredBy(text) }));
}

function nameDeclaredBy(text) {
    const found = /^export declare (?:function|const|class)\s+(\w+)/m.exec(text);
    return found === null ? null : found[1];
}

/**
 * The names the barrel hands over at run time.
 *
 * Read out of the barrel's own declarations rather than the whole graph's:
 * `require` answers with the barrel and nothing else, so a function declared
 * anywhere else is one the editor would offer and the page would refuse.
 */
function readOfferedValues(directory) {
    const barrel = readFileSync(join(directory, 'addon-api.d.ts'), 'utf8');
    const declared = [...barrel.matchAll(/^export declare (?:function|const|class)\s+(\w+)/gm)]
        .map((found) => found[1]);
    const passedOn = [...barrel.matchAll(/^export \{([^}]*)\}/gm)]
        .flatMap((found) => found[1].split(','))
        .filter((name) => !name.trim().startsWith('type '))
        .map((name) => name.split(/\s+as\s+/).pop().trim())
        .filter((name) => name !== '');
    return new Set([...declared, ...passedOn]);
}

/**
 * Drops every value the barrel does not pass on.
 *
 * A type left in costs nothing — it is erased before anything runs — but a
 * function is a call the editor would allow and the page would not answer. One
 * still named by a declaration that stays has to stay too, or what refers to it
 * no longer resolves; dropping is repeated until that settles.
 */
function dropUnoffered(files, offered) {
    let kept = files.map((file) => ({ ...file, blocks: [...file.blocks] }));

    for (;;) {
        const whole = kept.flatMap((file) => file.blocks);
        const doomed = whole.find((block) => (
            block.declares !== null
            && !offered.has(block.declares)
            && !isNamedBy(whole.filter((other) => other !== block), block.declares)
        ));
        if (doomed === undefined) {
            return kept;
        }
        kept = kept.map((file) => ({
            ...file,
            blocks: file.blocks.filter((block) => block !== doomed),
        }));
    }
}

function isNamedBy(blocks, name) {
    const named = new RegExp(`\\b${name}\\b`);
    return blocks.some((block) => named.test(block.text));
}

/** Puts the blocks back together as one module body. */
function joinDeclarations(files) {
    return files
        .filter((file) => file.blocks.length > 0)
        .map((file) => {
            const body = file.blocks.map((block) => block.text).join('\n');
            return `    // ${file.file}\n${body.split('\n').map((line) => (line === '' ? '' : `    ${line}`)).join('\n')}`;
        })
        .join('\n\n');
}

const { staging, emitted } = emitDeclarations();
const declarations = joinDeclarations(dropUnoffered(readBlocks(emitted), readOfferedValues(emitted)));
rmSync(staging, { recursive: true, force: true });

const MODULE = `declare module 'fathom' {
${declarations}
}
`;

/** The same declarations as a package's own, so an import of it resolves here. */
const FLAT = `${declarations.replace(/^ {4}/gm, '')}\n`;

writeFileSync(OUT, WANTS_DECLARATIONS
    ? `// Generated by scripts/build-addon-types.mjs. Do not edit.
// Run \`npm run build:addon-types\` after changing the addon surface.
//
// The whole of what a reading may import. Anything not here is not public.

${FLAT}`
    : `// Generated by scripts/build-addon-types.mjs. Do not edit.
// Run \`npm run build:addon-types\` after changing the addon surface.

/** What the in-page editor is told about the API an addon may reach. */
export const ADDON_SURFACE_TYPES = \`${MODULE.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`;
`);

console.log(`Wrote ${OUT} (${declarations.length} characters of declarations)`);
