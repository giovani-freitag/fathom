import { beforeEach, describe, expect, it } from 'vitest';
import { addonLog, buildAddonConsole, clearAddonLog } from '../../../../src/app/addons/addon-console.ts';

/** The console reaches the store a turn later, so a test has to let that turn pass. */
async function readLines() {
    await Promise.resolve();
    return addonLog.read();
}

beforeEach(() => { clearAddonLog(); });

describe('what a reading prints', () => {
    it('reaches the console beside it', async () => {
        buildAddonConsole().log('the close is', 42);

        const [line] = await readLines();

        expect(line).toEqual({ level: 'log', text: 'the close is 42', from: '', repeats: 1 });
    });

    it('keeps a warning apart from a plain line', async () => {
        const printer = buildAddonConsole();

        printer.warn('careful');
        printer.error('stopped');

        expect((await readLines()).map((line) => line.level)).toEqual(['warn', 'error']);
    });

    it('counts a line printed again rather than repeating it', async () => {
        // A reading is redrawn on every bar, so one print inside `compute`
        // arrives hundreds of times and buries everything else.
        const printer = buildAddonConsole();

        printer.log('drawing');
        printer.log('drawing');
        printer.log('drawing');

        expect(await readLines()).toEqual([{ level: 'log', text: 'drawing', from: '', repeats: 3 }]);
    });

    it('counts it as a repeat even when the redraws are turns apart', async () => {
        // The ordinary case: one print inside `compute`, which the chart calls
        // again on every bar. Counted only within a turn, this is a fresh line
        // each time and the console fills with the same word.
        const printer = buildAddonConsole();

        printer.log('drawing');
        await readLines();
        printer.log('drawing');

        expect(await readLines()).toEqual([{ level: 'log', text: 'drawing', from: '', repeats: 2 }]);
    });

    it('keeps the last of it rather than everything', async () => {
        const printer = buildAddonConsole();

        for (let step = 0; step < 260; step += 1) {
            printer.log(`bar ${step}`);
        }

        const lines = await readLines();
        expect(lines).toHaveLength(200);
        expect(lines[lines.length - 1]?.text).toBe('bar 259');
    });

    it('publishes once for a whole loop, not once a line', async () => {
        const printer = buildAddonConsole();
        let published = 0;
        const stop = addonLog.subscribe(() => { published += 1; });

        printer.log('one');
        printer.log('two');
        printer.log('three');
        await readLines();
        stop();

        expect(published).toBe(1);
    });

    it('keeps two readings apart even when they print the same words', async () => {
        // Collapsed on the words alone, one reading's line would swallow
        // another's and the count would say something that never happened.
        buildAddonConsole(() => 'Mine').log('drawing');
        buildAddonConsole(() => 'Yours').log('drawing');

        expect((await readLines()).map((line) => line.from)).toEqual(['Mine', 'Yours']);
    });

    it('is emptied when the reader asks', async () => {
        buildAddonConsole().log('something');
        await readLines();

        clearAddonLog();

        expect(addonLog.read()).toEqual([]);
    });
});

describe('printing something that is not a word', () => {
    it('opens an object rather than calling it an object', async () => {
        buildAddonConsole().log({ period: 20, tone: 'phosphor' });

        expect((await readLines())[0]?.text).toBe('{ period: 20, tone: "phosphor" }');
    });

    it('says how long a series is, which is what a reader is checking', async () => {
        buildAddonConsole().log(Float64Array.from([1.5, 2.5]));

        expect((await readLines())[0]?.text).toBe('Float64Array(2) [1.5, 2.5]');
    });

    it('counts what it did not show rather than printing all of it', async () => {
        buildAddonConsole().log(Array.from({ length: 20 }, (_unused, index) => index));

        expect((await readLines())[0]?.text).toContain('…8 more');
    });

    it('says what an error was, not that it was an object', async () => {
        buildAddonConsole().log(new RangeError('too few bars'));

        expect((await readLines())[0]?.text).toBe('RangeError: too few bars');
    });

    it('survives something that holds itself', async () => {
        const held: Record<string, unknown> = { name: 'mine' };
        held['self'] = held;

        buildAddonConsole().log(held);

        expect((await readLines())[0]?.text).toBe('{ name: "mine", self: [circular] }');
    });

    it('names a function rather than printing its body', async () => {
        buildAddonConsole().log(function mean() { return 0; });

        expect((await readLines())[0]?.text).toBe('ƒ mean()');
    });
});
