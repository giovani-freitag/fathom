import { describe, expect, it } from 'vitest';
import type { EditorStatus } from '../../../../src/app/react/use-addon-editor.ts';
import { reportOn, sayOfDiscarded } from '../../../../src/app/ui/editor-report.ts';
import type { DiscardedWork } from '../../../../src/app/react/use-addon-editor.ts';

const READY: EditorStatus = { kind: 'ready', label: 'My mean' };
const FAULTED: EditorStatus = {
    kind: 'faulted',
    faults: [{ message: "Cannot find module 'date-fns'", line: 2, column: 1, file: 'main.ts' }],
};

describe('what the panel says when more than one thing has something to report', () => {
    it('says what the reading threw while it was being drawn', () => {
        expect(reportOn(READY, 'the arithmetic gave up'))
            .toEqual({ kind: 'threw', message: 'the arithmetic gave up' });
    });

    it('says why it will not build, over a throw from the reading it replaced', () => {
        // The two are different reports and the panel shows one. A throw is
        // only about code that built; put ahead of the faults unconditionally,
        // it sat over the compiler's own answer about the code in the editor —
        // so a reader saw a message about a reading they could no longer see.
        expect(reportOn(FAULTED, 'the arithmetic gave up').kind).toBe('faulted');
    });

    it('says the same about anything else that went wrong', () => {
        const broken: EditorStatus = { kind: 'broken', message: 'the shelf refused it' };

        expect(reportOn(broken, 'the arithmetic gave up'))
            .toEqual({ kind: 'broken', message: 'the shelf refused it' });
    });

    it('says it is starting before the first build lands', () => {
        expect(reportOn(null, null)).toEqual({ kind: 'starting' });
    });

    it('says nothing about a throw before anything has built', () => {
        expect(reportOn(null, 'left over').kind).toBe('starting');
    });

    it('says what is being drawn when nothing is wrong', () => {
        expect(reportOn(READY, null)).toEqual({ kind: 'drawing', label: 'My mean' });
    });
});

const leaving = (was: Partial<DiscardedWork>): DiscardedWork => ({
    name: 'Pressure',
    files: {},
    compiled: {},
    key: null,
    wasDeleted: false,
    wasFiled: false,
    ...was,
});

describe('what the panel says about work that has just left the editor', () => {
    it('says a draft was replaced without being saved', () => {
        expect(sayOfDiscarded(leaving({}))).toBe('editor.replaced');
    });

    it('does not claim a saved reading was lost', () => {
        // Told it closed without being saved, a reader who saved it seconds ago
        // reads that as their save having failed. It is on the shelf.
        expect(sayOfDiscarded(leaving({ key: 'pressure', wasFiled: true }))).toBe('editor.closed');
    });

    it('says a deleted reading was removed, saved or not', () => {
        expect(sayOfDiscarded(leaving({ wasDeleted: true, wasFiled: true }))).toBe('indicators.removed');
    });

    it('says a saved reading with unsaved edits was replaced', () => {
        expect(sayOfDiscarded(leaving({ key: 'pressure', wasFiled: false }))).toBe('editor.replaced');
    });
});
