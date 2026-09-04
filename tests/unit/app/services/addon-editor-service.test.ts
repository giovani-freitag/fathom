import { beforeEach, describe, expect, it } from 'vitest';
import { AddonEditorService } from '../../../../src/app/services/addon-editor/addon-editor-service.ts';
import { forgetModels, liveModels } from '../../../mocks/monaco-editor.ts';

function buildService() {
    return new AddonEditorService({ onChange: () => undefined });
}

beforeEach(() => { forgetModels(); });

describe('putting a different reading in the editor', () => {
    it('rewrites a file that survives rather than building it again', () => {
        // A model taken down and put back at the URI it had is one the language
        // service goes on holding the old text of. A reading opened whole then
        // compiled as the one it replaced, and only a keystroke put it right.
        const service = buildService();
        service.replaceFiles({ 'main.ts': 'the first' });
        const held = [...liveModels().values()][0]!;

        service.replaceFiles({ 'main.ts': 'the second' });

        expect(held.isDisposed).toBe(false);
        expect(held.getValue()).toBe('the second');
    });

    it('takes away a file the new reading does not have', () => {
        const service = buildService();
        service.replaceFiles({ 'main.ts': 'the entry', 'helpers.ts': 'the helpers' });

        service.replaceFiles({ 'main.ts': 'the entry' });

        expect(service.listFiles()).toEqual(['main.ts']);
        expect(liveModels().has('file:///reading/helpers.ts')).toBe(false);
    });

    it('builds one the new reading has and the old did not', () => {
        const service = buildService();
        service.replaceFiles({ 'main.ts': 'the entry' });

        service.replaceFiles({ 'main.ts': 'the entry', 'helpers.ts': 'the helpers' });

        expect(service.listFiles()).toEqual(['main.ts', 'helpers.ts']);
    });

    it('opens on the entry rather than a file the new reading does not have', () => {
        const service = buildService();
        service.replaceFiles({ 'main.ts': 'the entry', 'helpers.ts': 'the helpers' });
        service.showFile('helpers.ts');

        service.replaceFiles({ 'main.ts': 'the entry' });

        expect(service.shownFile()).toBe('main.ts');
    });

    it('gives a reading with no files at all an entry to write in', () => {
        const service = buildService();

        service.replaceFiles({});

        expect(service.listFiles()).toEqual(['main.ts']);
    });
});

describe('the files of one reading', () => {
    it('refuses a name that is not one a file can have', () => {
        const service = buildService();
        service.replaceFiles({ 'main.ts': '' });

        expect(() => { service.addFile('../escape.ts'); }).toThrow(/not a name a file can have/);
        expect(() => { service.addFile('notes.md'); }).toThrow(/not a name a file can have/);
    });

    it('refuses one the reading already has', () => {
        const service = buildService();
        service.replaceFiles({ 'main.ts': '', 'helpers.ts': '' });

        expect(() => { service.addFile('helpers.ts'); }).toThrow(/already has a helpers\.ts/);
    });

    it('keeps what was written when a file is moved', () => {
        const service = buildService();
        service.replaceFiles({ 'main.ts': '', 'helpers.ts': 'a morning of work' });

        service.renameFile('helpers.ts', 'maths/mean.ts');

        expect(service.readFiles()).toEqual({ 'main.ts': '', 'maths/mean.ts': 'a morning of work' });
    });

    it('leaves the entry where it is, whatever it is asked', () => {
        const service = buildService();
        service.replaceFiles({ 'main.ts': 'the entry' });

        service.renameFile('main.ts', 'elsewhere.ts');
        service.removeFile('main.ts');

        expect(service.listFiles()).toEqual(['main.ts']);
    });

    it('shows the entry first, wherever its name would sort', () => {
        const service = buildService();

        service.replaceFiles({ 'main.ts': '', 'a.ts': '', 'z.ts': '' });

        expect(service.listFiles()).toEqual(['main.ts', 'a.ts', 'z.ts']);
    });
});
