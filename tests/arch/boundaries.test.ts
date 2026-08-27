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
    // The browser archive is persistence like any other, so the app reaches it
    // the way the server reaches Postgres. The engines are kept apart below,
    // which is what stops a driver meant for one from reaching the other.
    // The demo registers the same collector the server does, as a Web Worker.
    // It reaches the unit's own folders to build the runtime, and the browser
    // archive because that is the engine the page records into.
    'src/app': [
        'src/app',
        'src/database/browser',
        'src/database/core',
        'src/database/services/liquidity-archive.ts',
        'src/workers',
        'src/shared',
    ],
};

/**
 * Packages that belong to exactly one place.
 *
 * Narrower than the runtime that uses them where a bundle is at stake: `pg`
 * confined to the Postgres subtree and `ws` to one adapter is what lets the
 * collector be registered as a Web Worker without dragging Node into the page.
 */
const CONFINED_PACKAGES: Record<string, string> = {
    pg: 'src/database/postgres',
    ws: 'src/workers/transport/node-market-data-socket.ts',
    // The page implements the same log port by posting to its host, so the
    // file-writing logger must not follow the collector into the bundle.
    pino: 'src/workers/transport/node-collector-log.ts',
    'pino-roll': 'src/workers/transport/node-collector-log.ts',
    // Only the demo's own registration may construct a Worker; the collector
    // is reached by URL, never imported into the page's bundle.

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
                .filter((path) => path !== runtime && !path.startsWith(`${runtime}/`));

            expect(strays).toEqual([]);
        });
    }

    it('constructs a Worker only from the service that registers one', () => {
        const constructors = sourceFiles.filter((path) => /new Worker\(/.test(read(path)));

        expect(constructors).toEqual(['src/app/services/collector-worker-service.ts']);
    });

    it('speaks IndexedDB only from the browser archive', () => {
        const speakers = sourceFiles.filter((path) => /\bindexedDB\b|IDBKeyRange|IDBObjectStore/.test(read(path)));

        expect(speakers.every((path) => path.startsWith('src/database/browser/')
            || path.startsWith('src/workers/browser/')
            || path.startsWith('src/app/'))).toBe(true);
    });

    it('reaches the venue over the network from two places, both named', () => {
        // The collector, which records the book, and the wiring that hands the
        // chart its candles — public history the venue serves for any past day.
        // A third caller is the venue leaking into the rest of the product.
        const callers = sourceFiles.filter((path) => /binance\.com/.test(read(path)));

        expect(callers.every((path) => path.startsWith('src/workers/')
            || path === 'src/app/core/venue-candles.ts')).toBe(true);
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

describe('controls that mean the same thing look the same', () => {
    it('has one switch, written once', () => {
        // Two of them once sat in the same panel with knobs of different
        // colours travelling different distances, which reads as two kinds of
        // control rather than one control used twice.
        const rolled = sourceFiles
            .filter((path) => !path.endsWith('ui/toggle-switch.tsx'))
            .filter((path) => read(path).includes('Switch.Root'));

        expect(rolled).toEqual([]);
    });

    it('parks the knob where the geometry puts it', () => {
        // A track of thirty-six less a knob of sixteen leaves two pixels of
        // clearance at each end. Sixteen parks it off-centre against the edge.
        const written = read('src/app/ui/toggle-switch.tsx');

        expect(written).toContain('translate-x-[18px]');
    });
});

describe('the interface is built from parts, not from repeated markup', () => {
    it('spells no set of classes out in more than two places', () => {
        // Not a ban on repetition — two places is a coincidence and four is a
        // component nobody wrote. Every one of the shapes that crossed this line
        // had drifted: two switches with different knobs, seven icon buttons in
        // two sizes, two notices at widths neither could justify.
        const uses = new Map<string, string[]>();
        for (const path of sourceFiles.filter((file) => file.endsWith('.tsx'))) {
            for (const match of read(path).matchAll(/className="([^"]{25,})"/g)) {
                const classes = match[1]!;
                uses.set(classes, [...uses.get(classes) ?? [], path]);
            }
        }

        const overused = [...uses.entries()]
            .filter(([, places]) => places.length > 2)
            .map(([classes, places]) => `${classes.slice(0, 40)} (×${places.length})`);

        expect(overused).toEqual([]);
    });
});

describe('what a function asks to be handed', () => {
    it('never takes more than three things in a row', () => {
        // Beyond three, an argument list stops reading as a sentence and starts
        // reading as an order to be remembered. Every one that crossed the line
        // here had two of the same type side by side — a start and an end, two
        // sizes, an id and a name — where transposing them compiles and the
        // chart is quietly wrong.
        const overloaded: string[] = [];
        for (const path of sourceFiles) {
            const text = read(path);
            const signatures = text.matchAll(
                /(?:function\s+(\w+)|^\s{4}(?:private |protected |public |async )*(\w+))\(([^)]{0,400}?)\)\s*:/gm,
            );
            for (const signature of signatures) {
                const declared = signature[3]!.trim();
                // A destructured object is one thing, however many names it
                // spreads into; that is the shape this rule asks for.
                if (declared === '' || declared.startsWith('{')) {
                    continue;
                }
                const parameters = declared.split(/,(?![^<]*>)/).filter((one) => one.trim() !== '');
                if (parameters.length > 3) {
                    overloaded.push(`${path} ${signature[1] ?? signature[2]} (${parameters.length})`);
                }
            }
        }

        expect(overloaded).toEqual([]);
    });
});

describe('a settings panel is built from one kind of section', () => {
    it('rules a section off in one place, so the breath after it is the same', () => {
        // Three different amounts of breath after the same horizontal rule is
        // what a reader sees as an interface that was not decided, and one of
        // them had no title at all: a run of figures started under a pair of
        // switches with nothing saying it was a different subject.
        const spelled = sourceFiles
            .filter((path) => path.endsWith('.tsx'))
            .filter((path) => !path.endsWith('ui/panel-section.tsx'))
            .filter((path) => !path.endsWith('ui/about-panel.tsx'))
            .filter((path) => /border-t border-hairline pt-/.test(read(path)));

        expect(spelled).toEqual([]);
    });
});

describe('a reader is asked to pick in one way', () => {
    it('has one select, written once', () => {
        // Three of them once shared a screen: a menu forty-four pixels tall, a
        // native one at twenty-six, and a third built out of a dropdown. Same
        // question asked of the reader, three shapes to learn.
        const rolled = sourceFiles
            .filter((path) => !path.endsWith('ui/select.tsx'))
            .filter((path) => /<select|DropdownMenu\.|Select\.Root/.test(read(path)));

        expect(rolled).toEqual([]);
    });
});
