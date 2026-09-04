import { beforeEach, describe, expect, it } from 'vitest';
import { addonLog, clearAddonLog } from '../../../../src/app/addons/addon-console.ts';
import { buildAddon } from '../../../../src/app/addons/addon-runtime.ts';
import { ENTRY_FILE } from '../../../../src/shared/core/reading-files.ts';
import { completePlan } from '../../../../src/shared/core/draw-plan.ts';
import { buildRun, buildWindow } from '../../../mocks/price-bars.ts';

const BARS = buildWindow(buildRun(6, (index) => 100 + index));

/** What the editor's compiler emits for a reading written against the surface. */
const COMPILED = `
const fathom = require('fathom');
const PERIOD = fathom.Params.integer('periodBars').called('Period').between(2, 400).startingAt(3);
class Mine {
    label = 'My mean';
    parameters = [PERIOD];
    resolveSources(settings) {
        return { warmupBars: fathom.readSetting(settings, PERIOD) };
    }
    compute(input) {
        const closes = input.bars.bars.map((bar) => bar.closePrice);
        return fathom.Plot.over(input.bars).line(closes, 'Mine').in('amber').overThePrice();
    }
}
exports.default = Mine;
`;

/**
 * The message a build failed with.
 *
 * Read out rather than matched against the whole object: `toMatchObject` does
 * not test a regular expression against a string, so every assertion written
 * that way passes whatever the message actually says.
 */
function buildOne(source: string) {
    return buildAddon({ [ENTRY_FILE]: source });
}

function failureOf(built: ReturnType<typeof buildAddon>): string {
    return built.kind === 'failed' ? built.message : 'it succeeded instead';
}

describe('taking a reading out of compiled source', () => {
    it('constructs the class it exported', () => {
        const built = buildOne(COMPILED);

        expect(built.kind).toBe('ready');
    });

    it('hands it a surface it can draw a real plan with', () => {
        const built = buildOne(COMPILED);
        if (built.kind !== 'ready') {
            throw new Error(built.message);
        }

        const plan = completePlan(
            { indicatorId: 'mine', indicator: built.indicator, settings: {}, warmupBarCount: 10 },
            built.indicator.compute({ bars: BARS, settings: {}, sessions: {} }),
        );

        expect(plan.label).toBe('My mean');
        expect(plan.scale).toEqual({ kind: 'price' });
        expect([...plan.series[0]!.value]).toEqual(BARS.bars.map((bar) => bar.closePrice));
    });

    it('takes an object as readily as a class', () => {
        const built = buildOne(
            "exports.default = { label: 'A', parameters: [], compute: () => ({ series: [] }) };",
        );

        expect(built.kind).toBe('ready');
    });
});

describe('what an addon is told when it is wrong', () => {
    it('says so when nothing was exported', () => {
        const built = buildOne('const unused = 1;');

        expect(failureOf(built)).toMatch(/Nothing was exported/);
    });

    it('names the fields the export is missing', () => {
        const built = buildOne("exports.default = { label: 'A' };");

        expect(failureOf(built)).toMatch(/missing: parameters, compute/);
    });

    it('says so when compute is not a method', () => {
        const built = buildOne("exports.default = { label: 'A', parameters: [], compute: 3 };");

        expect(failureOf(built)).toMatch(/has to be a method/);
    });

    it('carries a failure thrown while the script was loading', () => {
        const built = buildOne("throw new Error('I broke on purpose');");

        expect(failureOf(built)).toBe('I broke on purpose');
    });

    it('carries a failure thrown by the constructor', () => {
        const built = buildOne(
            'exports.default = class { constructor() { throw new Error("no"); } };',
        );

        expect(failureOf(built)).toMatch(/Could not construct/);
    });

    it('refuses to import anything but the surface', () => {
        // The only module an addon can reach. Everything the host owns — the
        // services, the archive, the socket — is on the other side of this.
        const built = buildOne("require('node:fs');");

        expect(failureOf(built)).toMatch(/can import 'fathom' and its own files/);
    });

    it('points at the line of the addon rather than of the wrapper', () => {
        const built = buildOne('\n\nthrow new Error("here");');

        expect(built.kind === 'failed' ? built.line : null).toBe(3);
    });
});

describe('what a reading built this way cannot reach', () => {
    it('is handed no way to get at the page it is running in', () => {
        // Not a sandbox — a script can still reach a global. What this does is
        // make the surface the only thing in scope by design, so reaching past
        // it has to be deliberate rather than accidental.
        const built = buildOne("exports.default = { label: typeof require('fathom').fetch };");

        expect(failureOf(built)).toMatch(/missing: parameters, compute/);
    });
});

describe('what a reading prints while it runs', () => {
    beforeEach(() => { clearAddonLog(); });

    it('goes to the panel beside it rather than into the page', async () => {
        const built = buildOne("console.log('from the reading'); exports.default = { label: 'x', parameters: [], compute: () => ({ series: [] }) };");
        await Promise.resolve();

        expect(built.kind).toBe('ready');
        expect(addonLog.read().map((line) => line.text)).toEqual(['from the reading']);
    });

    it('reaches it from inside the drawing too, not only while it is built', async () => {
        const built = buildOne("exports.default = { label: 'x', parameters: [], compute: () => { console.warn('drawing now'); return { series: [] }; } };");
        if (built.kind === 'ready') {
            built.indicator.compute({} as never);
        }
        await Promise.resolve();

        expect(addonLog.read()).toEqual([{ level: 'warn', text: 'drawing now', from: 'x', repeats: 1 }]);
    });
});

/** A reading whose arithmetic lives in a file of its own. */
const ACROSS_FILES = {
    'main.ts': `
        const helpers = require('./helpers');
        exports.default = {
            label: 'Split',
            parameters: [],
            compute: () => ({ series: [], mean: helpers.mean([2, 4]) }),
        };
    `,
    'helpers.ts': 'exports.mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;',
};

describe('a reading written across several files', () => {
    it('reaches what its own files export', () => {
        const built = buildAddon(ACROSS_FILES);

        expect(built.kind === 'ready' && built.indicator.compute({} as never)).toMatchObject({ mean: 3 });
    });

    it('finds a file named without its ending, the way an import is written', () => {
        const built = buildAddon({
            ...ACROSS_FILES,
            'main.ts': ACROSS_FILES['main.ts'].replace("'./helpers'", "'./helpers.ts'"),
        });

        expect(built.kind).toBe('ready');
    });

    it('resolves a file in a folder against the one importing it', () => {
        const built = buildAddon({
            'main.ts': `
                const near = require('./maths/near');
                exports.default = { label: near.name, parameters: [], compute: () => ({ series: [] }) };
            `,
            'maths/near.ts': "exports.name = require('../named').name;",
            'named.ts': "exports.name = 'Two doors up';",
        });

        expect(built.kind === 'ready' && built.indicator.label).toBe('Two doors up');
    });

    it('runs a file once however many others ask for it', () => {
        // A module is a value, not a template. Run twice, a file that counts
        // something starts counting again halfway through the reading.
        const built = buildAddon({
            'main.ts': `
                require('./one'); require('./two');
                exports.default = { label: String(require('./counter').count), parameters: [], compute: () => ({ series: [] }) };
            `,
            'counter.ts': 'exports.count = 0; exports.bump = () => { exports.count += 1; };',
            'one.ts': "require('./counter').bump();",
            'two.ts': "require('./counter').bump();",
        });

        expect(built.kind === 'ready' && built.indicator.label).toBe('2');
    });

    it('says which file it could not find, rather than that something is missing', () => {
        const built = buildOne("require('./nowhere'); exports.default = {};");

        expect(failureOf(built)).toMatch(/Nothing in this reading answers to '\.\/nowhere'/);
    });

    it('names the file a failure happened in', () => {
        const built = buildAddon({
            'main.ts': "require('./broken'); exports.default = {};",
            'broken.ts': "throw new Error('it broke here');",
        });

        expect(built.kind === 'failed' && built.file).toBe('broken.ts');
    });

    it('blames the failure that stopped it, not one the reading caught itself', () => {
        // A `require` inside a try/catch is ordinary code. Blamed for the first
        // throw of the run, the marker landed on a file that was never the
        // problem, at a line taken from a different one's stack.
        const built = buildAddon({
            'main.ts': "try { require('./optional'); } catch { /* fine */ } require('./broken'); exports.default = {};",
            'optional.ts': "throw new Error('this one is caught');",
            'broken.ts': "throw new Error('this one is not');",
        });

        expect(built.kind === 'failed' && built.file).toBe('broken.ts');
        expect(failureOf(built)).toBe('this one is not');
    });

    it('runs a file again after it threw, rather than handing back its wreckage', () => {
        // Left in the cache, a second `require` answered with whatever the file
        // assigned before it died, and the reading built on top of it.
        const built = buildAddon({
            'main.ts': "try { require('./broken'); } catch { /* fine */ } exports.default = { label: String(require('./broken').half), parameters: [], compute: () => ({ series: [] }) };",
            'broken.ts': "exports.half = 'assigned'; throw new Error('and then it broke');",
        });

        expect(failureOf(built)).toBe('and then it broke');
    });

    it('runs a file that exports nothing at all only once', () => {
        // `undefined` is a legitimate export and was also the sentinel for a
        // file nobody had run, so such a file ran again on every ask.
        const built = buildAddon({
            'main.ts': "require('./quiet'); require('./quiet'); exports.default = { label: String(require('./counter').count), parameters: [], compute: () => ({ series: [] }) };",
            'counter.ts': 'exports.count = 0; exports.bump = () => { exports.count += 1; };',
            'quiet.ts': "require('./counter').bump(); module.exports = undefined;",
        });

        expect(built.kind === 'ready' && built.indicator.label).toBe('1');
    });

    it('says nothing was exported when a file exports nothing', () => {
        const built = buildOne('module.exports = undefined;');

        expect(failureOf(built)).toMatch(/Nothing was exported/);
    });

    it('survives two files that ask for each other', () => {
        // Filed before it runs, a half-built module is what the other one gets;
        // filed after, the two call each other until the stack gives out.
        const built = buildAddon({
            'main.ts': "exports.first = 1; const other = require('./other'); exports.default = { label: other.label, parameters: [], compute: () => ({ series: [] }) };",
            'other.ts': "exports.label = 'Round ' + require('./main').first;",
        });

        expect(built.kind === 'ready' && built.indicator.label).toBe('Round 1');
    });
});
