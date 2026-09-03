import { beforeEach, describe, expect, it } from 'vitest';
import { addonLog, clearAddonLog } from '../../../../src/app/addons/addon-console.ts';
import { buildAddon } from '../../../../src/app/addons/addon-runtime.ts';
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
function failureOf(built: ReturnType<typeof buildAddon>): string {
    return built.kind === 'failed' ? built.message : 'it succeeded instead';
}

describe('taking a reading out of compiled source', () => {
    it('constructs the class it exported', () => {
        const built = buildAddon(COMPILED);

        expect(built.kind).toBe('ready');
    });

    it('hands it a surface it can draw a real plan with', () => {
        const built = buildAddon(COMPILED);
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
        const built = buildAddon(
            "exports.default = { label: 'A', parameters: [], compute: () => ({ series: [] }) };",
        );

        expect(built.kind).toBe('ready');
    });
});

describe('what an addon is told when it is wrong', () => {
    it('says so when nothing was exported', () => {
        const built = buildAddon('const unused = 1;');

        expect(failureOf(built)).toMatch(/Nothing was exported/);
    });

    it('names the fields the export is missing', () => {
        const built = buildAddon("exports.default = { label: 'A' };");

        expect(failureOf(built)).toMatch(/missing: parameters, compute/);
    });

    it('says so when compute is not a method', () => {
        const built = buildAddon("exports.default = { label: 'A', parameters: [], compute: 3 };");

        expect(failureOf(built)).toMatch(/has to be a method/);
    });

    it('carries a failure thrown while the script was loading', () => {
        const built = buildAddon("throw new Error('I broke on purpose');");

        expect(failureOf(built)).toBe('I broke on purpose');
    });

    it('carries a failure thrown by the constructor', () => {
        const built = buildAddon(
            'exports.default = class { constructor() { throw new Error("no"); } };',
        );

        expect(failureOf(built)).toMatch(/Could not construct/);
    });

    it('refuses to import anything but the surface', () => {
        // The only module an addon can reach. Everything the host owns — the
        // services, the archive, the socket — is on the other side of this.
        const built = buildAddon("require('node:fs');");

        expect(failureOf(built)).toMatch(/can import only 'fathom'/);
    });

    it('points at the line of the addon rather than of the wrapper', () => {
        const built = buildAddon('\n\nthrow new Error("here");');

        expect(built.kind === 'failed' ? built.line : null).toBe(3);
    });
});

describe('what a reading built this way cannot reach', () => {
    it('is handed no way to get at the page it is running in', () => {
        // Not a sandbox — a script can still reach a global. What this does is
        // make the surface the only thing in scope by design, so reaching past
        // it has to be deliberate rather than accidental.
        const built = buildAddon("exports.default = { label: typeof require('fathom').fetch };");

        expect(failureOf(built)).toMatch(/missing: parameters, compute/);
    });
});

describe('what a reading prints while it runs', () => {
    beforeEach(() => { clearAddonLog(); });

    it('goes to the panel beside it rather than into the page', async () => {
        const built = buildAddon("console.log('from the reading'); exports.default = { label: 'x', parameters: [], compute: () => ({ series: [] }) };");
        await Promise.resolve();

        expect(built.kind).toBe('ready');
        expect(addonLog.read().map((line) => line.text)).toEqual(['from the reading']);
    });

    it('reaches it from inside the drawing too, not only while it is built', async () => {
        const built = buildAddon("exports.default = { label: 'x', parameters: [], compute: () => { console.warn('drawing now'); return { series: [] }; } };");
        if (built.kind === 'ready') {
            built.indicator.compute({} as never);
        }
        await Promise.resolve();

        expect(addonLog.read()).toEqual([{ level: 'warn', text: 'drawing now', from: 'x', repeats: 1 }]);
    });
});
