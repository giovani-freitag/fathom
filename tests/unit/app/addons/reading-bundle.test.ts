import { describe, expect, it } from 'vitest';
import { readBundle } from '../../../../src/app/addons/reading-bundle.ts';

const wrap = (files: Record<string, unknown>, name?: string): string => JSON.stringify({
    fathom: 1,
    ...name === undefined ? {} : { name },
    files,
});

describe('a reading read out of an exported bundle', () => {
    it('opens the files it holds, under the name it carries', () => {
        const read = readBundle(wrap({ 'main.ts': 'export default 1;' }, 'Pressure'));

        expect(read).toEqual({
            kind: 'read',
            name: 'Pressure',
            files: { 'main.ts': 'export default 1;' },
        });
    });

    it('refuses a bundle whose path could name a file outside the reading', () => {
        // Dropped quietly, the reading opened with its import pointing at
        // nothing and the reader had only the compiler's "cannot find module"
        // to go on — no word about which file had gone, or that one had.
        expect(readBundle(wrap({ 'main.ts': 'x', '../../outside.ts': 'y' })))
            .toEqual({ kind: 'illegalPath', path: '../../outside.ts' });
    });

    it('names the offending path so the reader can go and look at it', () => {
        const read = readBundle(wrap({ 'main.ts': 'x', '/etc/passwd.ts': 'y' }));

        expect(read).toHaveProperty('path', '/etc/passwd.ts');
    });

    it('refuses a bundle with nothing to take the reading out of', () => {
        expect(readBundle(wrap({ 'helper.ts': 'export default 1;' })).kind).toBe('notOurs');
    });

    it('says a bad path over a missing entry, because that is the one to fix', () => {
        expect(readBundle(wrap({ '../out.ts': 'y' })).kind).toBe('illegalPath');
    });

    it('leaves out a value that is not source at all', () => {
        const read = readBundle(wrap({ 'main.ts': 'x', 'helper.ts': { not: 'text' } }));

        expect(read).toEqual({ kind: 'read', name: null, files: { 'main.ts': 'x' } });
    });

    it('is not ours without the marker, whatever else it holds', () => {
        expect(readBundle(JSON.stringify({ files: { 'main.ts': 'x' } })).kind).toBe('notOurs');
    });

    it('is not ours when it is not json', () => {
        expect(readBundle('export default 1;').kind).toBe('notOurs');
    });

    it('has no name of its own when the bundle carries none', () => {
        expect(readBundle(wrap({ 'main.ts': 'x' }))).toHaveProperty('name', null);
    });
});
