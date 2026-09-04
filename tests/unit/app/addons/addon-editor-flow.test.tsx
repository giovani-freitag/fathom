import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { ADDON_ID_PREFIX, forgetAddon, listAddons } from '../../../../src/app/addons/addon-registry.ts';
import { buildAddon } from '../../../../src/app/addons/addon-runtime.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { type EditorFactory, type SourceEditor, useAddonEditor } from '../../../../src/app/react/use-addon-editor.ts';
import { AddonLibraryService } from '../../../../src/app/services/addon-library/addon-library-service.ts';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';
import { ENTRY_FILE } from '../../../../src/shared/core/reading-files.ts';

/** A reading whose label says which source produced it. */
function sourceNamed(label: string): string {
    return `
        const fathom = require('fathom');
        exports.default = {
            label: ${JSON.stringify(label)},
            parameters: [],
            compute: (input) => fathom.Plot.over(input.bars)
                .line(input.bars.bars.map((bar) => bar.closePrice), ${JSON.stringify(label)})
                .overThePrice(),
        };
    `;
}

const STARTER = { [ENTRY_FILE]: sourceNamed('My mean') };

/**
 * An editor with no browser behind it.
 *
 * `compile` is deliberately slow so a test can press save before it lands,
 * which is the order that filed a reading with no compiled body at all.
 */
function buildFakeEditor(settleMs = 0) {
    let files: Record<string, string> = {};
    let shown = ENTRY_FILE;
    let onChange = (): void => undefined;
    const editor: SourceEditor = {
        mount: (_host, opening) => { files = { ...opening }; },
        unmount: () => undefined,
        // A copy, as the real one is: it reads each model in turn. Handing the
        // live object back let a caller's snapshot change under it.
        readFiles: () => ({ ...files }),
        listFiles: () => [ENTRY_FILE, ...Object.keys(files).filter((path) => path !== ENTRY_FILE).sort()],
        shownFile: () => shown,
        replaceFiles: (next) => { files = { ...next }; shown = ENTRY_FILE; },
        showFile: (path) => { shown = path; },
        addFile: (path) => {
            if (files[path] !== undefined) {
                throw new Error(`This reading already has a ${path}.`);
            }
            files[path] = '';
            shown = path;
        },
        removeFile: (path) => {
            if (path !== ENTRY_FILE) {
                delete files[path];
                shown = ENTRY_FILE;
            }
        },
        renameFile: (from, to) => {
            if (from === ENTRY_FILE || files[from] === undefined) {
                return;
            }
            files[to] = files[from]!;
            delete files[from];
            shown = to;
        },
        compile: async () => {
            // Only ever a timer when a test asked for one, so a test that
            // freezes the clock does not also freeze the compiler.
            if (settleMs > 0) {
                await new Promise((resolve) => { setTimeout(resolve, settleMs); });
            }
            if (isRefusing) {
                throw new Error('the compiler never answered');
            }
            // Sampled after the wait, as the real one is: what a test types
            // while the compiler works is in the pair or in neither.
            const held = { ...files };
            if (isFaulting) {
                return { files: held, compiled: {}, faults: [{ message: 'no', line: 1, column: 1, file: ENTRY_FILE }] };
            }
            // The fake is its own compiler: the source is already the emitted
            // shape, so what a test writes is what the runtime is handed.
            return { files: held, compiled: held, faults: [] };
        },
        showRuntimeFault: () => undefined,
        applyTheme: () => undefined,
    };
    let onSave = (): void => undefined;
    let isFaulting = false;
    let isRefusing = false;
    const factory: EditorFactory = (config) => {
        onChange = config.onChange;
        onSave = config.onSave;
        // A fresh reference each time, as the real one is: what tells a live
        // editor from one that has been replaced is its identity.
        return { ...editor };
    };
    return {
        factory,
        type: (next: string): void => { files = { ...files, [shown]: next }; onChange(); },
        /** Writes into one of the reading's other files. */
        typeInto: (path: string, next: string): void => { files = { ...files, [path]: next }; onChange(); },
        /** What Ctrl+S does, as the editor would fire it. */
        pressSave: (): void => { onSave(); },
        /** Makes every compile report a fault, as a typo would. */
        faultFrom: (): void => { isFaulting = true; },
        /** Makes the compiler itself refuse, as one not yet started does. */
        refuseFrom: (): void => { isRefusing = true; },
        /** What is actually in the editor, which a refusal must not disturb. */
        buffer: (): string => files[shown] ?? '',
    };
}

const registered = new Set<string>();

afterEach(() => {
    for (const { id } of listAddons()) {
        registered.add(id);
    }
    registered.forEach(forgetAddon);
    registered.clear();
    vi.restoreAllMocks();
});

function renderEditor(factory: EditorFactory, openOn?: string, existing?: ReturnType<typeof createIndicatorKernel>) {
    const kernel = existing ?? createIndicatorKernel([]);
    const wrapper = ({ children }: { readonly children: ReactNode }): ReactElement => (
        <KernelProvider container={kernel.container}>{children}</KernelProvider>
    );
    const rendered = renderHook(
        () => useAddonEditor({ starter: STARTER, openOn, buildEditor: factory, onLeave: () => undefined }),
        { wrapper },
    );
    act(() => { rendered.result.current.mountInto(document.createElement('div')); });
    return { kernel, ...rendered };
}

describe('opening the editor', () => {
    it('has nothing outstanding, because opening is not editing', async () => {
        // The only signal a reader has about whether their work is safe. Set on
        // open, it is wrong from the first moment and they learn to ignore it.
        const { factory } = buildFakeEditor();

        const { result } = renderEditor(factory);

        await waitFor(() => { expect(result.current.name).toBe('My mean'); });
        expect(result.current.isUnsaved).toBe(false);
    });

    it('reports what is wrong now, not what the last reading threw', async () => {
        // The throw and the faults are two different reports, and the panel
        // shows one. A throw from a reading since replaced sat over the faults
        // of the one in the editor, so the reason it would not build was hidden
        // behind a message about code nobody could see.
        const { factory, faultFrom, type } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });

        faultFrom();
        act(() => { type(sourceNamed('Since replaced')); });

        await waitFor(() => { expect(result.current.status?.kind).toBe('faulted'); });
        expect(result.current.drawFailure).toBeNull();
    });

    it('says so when the compiler itself never answers', async () => {
        // Left uncaught, the panel sat on "Starting…" for the rest of the
        // session and the only trace was a rejection in the console.
        const { factory, refuseFrom, type } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });

        refuseFrom();
        act(() => { type(STARTER[ENTRY_FILE]); });

        await waitFor(() => { expect(result.current.status?.kind).toBe('broken'); });
    });

    it('stops showing faults about a script the editor no longer holds', async () => {
        // A compile that lands after the editor went away was left on screen,
        // faults and all, about code nobody could see any more.
        const { factory, faultFrom, type } = buildFakeEditor(30);
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
        faultFrom();
        act(() => { type('broken'); });

        act(() => { result.current.mountInto(null); });

        await waitFor(() => { expect(result.current.status).toBeNull(); });
    });

    it('takes its preview off the chart when it closes unsaved', async () => {
        // Opening the editor out of curiosity and closing it left a layer on
        // the chart that outlived every trace of what drew it.
        const { factory } = buildFakeEditor();
        const { kernel, unmount } = renderEditor(factory);
        await waitFor(() => { expect(kernel.readAdded()).toHaveLength(1); });

        unmount();

        expect(kernel.readAdded()).toEqual([]);
    });

    it('leaves a saved reading on the chart when it closes', async () => {
        const { factory } = buildFakeEditor();
        const { kernel, result, unmount } = renderEditor(factory);
        await act(async () => { await result.current.save(); });

        unmount();

        expect(kernel.readAdded().map((entry) => entry.indicatorId))
            .toEqual([`${ADDON_ID_PREFIX}my-mean`]);
    });

    it('draws a second reading in a colour the first one is not using', async () => {
        // Every reading was put on the chart in the one colour. A reader with
        // two of them had two lines they could not tell apart, and a legend
        // whose dot said the same thing about both.
        const first = buildFakeEditor();
        const { kernel, result, unmount } = renderEditor(first.factory);
        await act(async () => { await result.current.save(); });
        unmount();

        const second = buildFakeEditor();
        act(() => { second.type(sourceNamed('My other mean')); });
        const later = renderEditor(second.factory, undefined, kernel);
        act(() => { later.result.current.rename('My other mean'); });
        await act(async () => { await later.result.current.save(); });

        const tones = kernel.readAdded().map((entry) => entry.tone);
        expect(new Set(tones).size).toBe(tones.length);
    });

    it('draws what it opened with, without being asked', () => {
        const { factory } = buildFakeEditor();

        const { kernel } = renderEditor(factory);

        return waitFor(() => {
            expect(kernel.readPlans().map((plan) => plan.label)).toEqual(['My mean']);
        });
    });

    it('calls the reading what its own code calls it', async () => {
        const { factory } = buildFakeEditor();

        const { result } = renderEditor(factory);

        await waitFor(() => { expect(result.current.name).toBe('My mean'); });
    });

    it('stops following the code once the reader has named it', async () => {
        const { factory, type } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.name).toBe('My mean'); });

        act(() => { result.current.rename('Minha média'); });
        act(() => { type(sourceNamed('Renamed in code')); });

        await waitFor(() => { expect(result.current.isUnsaved).toBe(true); });
        expect(result.current.name).toBe('Minha média');
    });
});

describe('saving a reading', () => {
    it('answers the chord every text box in the world answers to', async () => {
        // Ctrl+S in a code editor that is not bound opens the browser's
        // save-page dialog, which is the wrong answer to the right reflex.
        const { factory, pressSave } = buildFakeEditor();
        const { kernel } = renderEditor(factory);

        await act(async () => { pressSave(); await Promise.resolve(); });

        await waitFor(() => { expect(kernel.container.addons.list()).toHaveLength(1); });
    });

    it('never files a source and a compiled that disagree', async () => {
        // The pair is what a reload rebuilds from. Filed apart, the chart draws
        // arithmetic that is nowhere in the file the editor shows.
        const { factory, type, faultFrom } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await act(async () => { await result.current.save(); });
        faultFrom();
        act(() => { type(sourceNamed('Broken')); });

        await act(async () => { await result.current.save(); });
        const [filed] = kernel.container.addons.list();
        const rebuilt = buildAddon(filed?.compiled ?? {});
        expect(rebuilt.kind).toBe('ready');
        expect(rebuilt.kind === 'ready' ? rebuilt.indicator.label : null).toBe(filed?.name);
    });

    it('says so when the browser refuses to keep it, and keeps saying unsaved', async () => {
        const { factory, type } = buildFakeEditor();
        const kernel = createIndicatorKernel([]);
        // The real service over storage that will not take it, which is a
        // private window or a browser with site data turned off.
        Object.assign(kernel.container, {
            addons: new AddonLibraryService({
                storage: { getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => undefined },
                now: () => 1,
            }),
        });
        const wrapper = ({ children }: { readonly children: ReactNode }): ReactElement => (
            <KernelProvider container={kernel.container}>{children}</KernelProvider>
        );
        const { result } = renderHook(
            () => useAddonEditor({ starter: STARTER, buildEditor: factory, onLeave: () => undefined }),
            { wrapper },
        );
        act(() => { result.current.mountInto(document.createElement('div')); });
        act(() => { type(sourceNamed('Edited')); });
        await waitFor(() => { expect(result.current.isUnsaved).toBe(true); });

        await act(async () => { await result.current.save(); });

        expect(result.current.status).toMatchObject({ kind: 'broken' });
        expect(result.current.isUnsaved).toBe(true);
    });

    it('keeps the compiled form even when saved before the first compile lands', async () => {
        // Found live: pressing save the moment the panel opened filed a reading
        // with an empty body, and it did not come back on the next reload.
        const { factory } = buildFakeEditor(50);
        const { kernel, result } = renderEditor(factory);

        await act(async () => { await result.current.save(); });

        const [saved] = kernel.container.addons.list();
        expect(saved?.compiled).not.toBe('');
        expect(saved?.name).toBe('My mean');
    });

    it('moves the copy on the chart onto it, rather than drawing a second', async () => {
        // Before the first save the reading is on the chart under a name it
        // will not keep. Left there, saving drew it twice and removing one of
        // them removed the wrong one.
        const { factory } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await waitFor(() => { expect(kernel.readAdded()).toHaveLength(1); });

        await act(async () => { await result.current.save(); });

        expect(kernel.readAdded().map((entry) => entry.indicatorId))
            .toEqual([`${ADDON_ID_PREFIX}my-mean`]);
    });

    it('files it under a key built from what it is called', async () => {
        const { factory } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);

        await act(async () => { await result.current.save(); });

        expect(kernel.container.addons.list().map((one) => one.key)).toEqual(['my-mean']);
    });

    it('keeps the same key when the reading is renamed, so the chart keeps it', async () => {
        const { factory } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await act(async () => { await result.current.save(); });

        act(() => { result.current.rename('Something else'); });
        await act(async () => { await result.current.save(); });

        expect(kernel.container.addons.list().map((one) => one.key)).toEqual(['my-mean']);
    });

    it('says it has nothing outstanding once it is written', async () => {
        const { factory, type } = buildFakeEditor();
        const { result } = renderEditor(factory);
        act(() => { type(sourceNamed('Edited')); });
        await waitFor(() => { expect(result.current.isUnsaved).toBe(true); });

        await act(async () => { await result.current.save(); });

        expect(result.current.isUnsaved).toBe(false);
    });
});

describe('opening a file', () => {
    it('refuses one too large to be a reading, without touching the editor', async () => {
        // Refused before it is read in, not after: what it would land on top of
        // is whatever the reader had not saved.
        const { factory, buffer } = buildFakeEditor();
        const { result } = renderEditor(factory);
        // Settled first: the opening compile is in flight, and its result would
        // otherwise land on top of the refusal this is about.
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
        const before = buffer();

        await act(async () => {
            await result.current.importFile(new File(['x'.repeat(300_000)], 'huge.ts'));
        });

        expect(buffer()).toBe(before);
        expect(result.current.status?.kind).toBe('broken');
    });

    it('refuses one that is not text, without touching the editor', async () => {
        const { factory, buffer } = buildFakeEditor();
        const { result } = renderEditor(factory);
        // Settled first: the opening compile is in flight, and its result would
        // otherwise land on top of the refusal this is about.
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
        const before = buffer();

        await act(async () => {
            await result.current.importFile(new File(['\u0000\u0001binary'], 'shot.png'));
        });

        expect(buffer()).toBe(before);
        expect(result.current.status?.kind).toBe('broken');
    });

    it('opens one that is a reading', async () => {
        const { factory } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);

        await act(async () => {
            await result.current.importFile(new File([sourceNamed('From a file')], 'mine.ts'));
        });

        await waitFor(() => {
            expect(kernel.readPlans().map((plan) => plan.label)).toEqual(['From a file']);
        });
    });
});

describe('surviving a remount', () => {
    it('keeps what was typed when the editor is put back', async () => {
        // Anything that narrows the window takes the panel down with it, and a
        // drag of the window edge is not a decision to discard work.
        const { factory, type } = buildFakeEditor();
        const { kernel, result, unmount } = renderEditor(factory);
        act(() => { type(sourceNamed('Half written')); });
        await waitFor(() => { expect(result.current.isUnsaved).toBe(true); });
        unmount();

        const again = renderEditor(factory, undefined, kernel);

        await waitFor(() => {
            expect(again.kernel.readPlans().map((plan) => plan.label)).toEqual(['Half written']);
        });
    });
});

describe('putting a saved reading back', () => {
    it('stops calling it a draft once it is filed', async () => {
        // The draft is what has not been saved. Kept after filing, opening a
        // different reading later would land on top of work already on the
        // shelf.
        const { factory, type } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        act(() => { type(sourceNamed('Filed')); });
        await waitFor(() => { expect(kernel.container.addons.readDraft()).not.toBeNull(); });

        await act(async () => { await result.current.save(); });

        expect(kernel.container.addons.readDraft()).toBeNull();
    });


    it('opens blank when nothing was named, rather than on the last one saved', async () => {
        // A button that says "write a reading" opened one the reader already
        // had, with its key bound, and the next save replaced it.
        const { factory } = buildFakeEditor();
        const { kernel, result, unmount } = renderEditor(factory);
        await act(async () => { await result.current.save(); });
        expect(kernel.container.addons.list()).toHaveLength(1);
        unmount();

        // Reopened on the same shelf, naming nothing.
        const second = renderEditor(factory, undefined, kernel);

        await waitFor(() => { expect(second.result.current.openKey).toBeNull(); });
        expect(second.result.current.saved).toHaveLength(1);
    });


    it('opens one off the shelf', async () => {
        const { factory, type } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await act(async () => { await result.current.save(); });
        act(() => { result.current.startAnew(); });
        act(() => { type(sourceNamed('Second')); });
        await act(async () => { await result.current.save(); });

        act(() => { result.current.open('my-mean'); });

        await waitFor(() => { expect(result.current.name).toBe('My mean'); });
        expect(kernel.container.addons.list()).toHaveLength(2);
    });

    it('starts a new one without touching what is on the shelf', async () => {
        const { factory } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await act(async () => { await result.current.save(); });

        act(() => { result.current.startAnew(); });

        await waitFor(() => { expect(result.current.openKey).toBeNull(); });
        expect(kernel.container.addons.list()).toHaveLength(1);
    });
});

describe('replacing what is in the editor', () => {
    it('offers back what a new one replaced', async () => {
        // Starting a new one is not a decision to throw away what was there.
        const { factory, type } = buildFakeEditor();
        const { result } = renderEditor(factory);
        act(() => { type(sourceNamed('Half written')); });
        await waitFor(() => { expect(result.current.name).toBe('Half written'); });

        act(() => { result.current.startAnew(); });

        expect(result.current.lastDiscarded?.name).toBe('Half written');
        expect(result.current.lastDiscarded?.wasDeleted).toBe(false);
    });

    it('offers back what opening another replaced', async () => {
        const { factory, type } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await act(async () => { await result.current.save(); });
        act(() => { result.current.startAnew(); });
        act(() => { type(sourceNamed('Second')); });
        await waitFor(() => { expect(result.current.name).toBe('Second'); });

        act(() => { result.current.open('my-mean'); });

        expect(result.current.lastDiscarded?.name).toBe('Second');
    });

    it('puts it back where it was when undone', async () => {
        const { factory, type } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        act(() => { type(sourceNamed('Half written')); });
        await waitFor(() => { expect(result.current.name).toBe('Half written'); });
        act(() => { result.current.startAnew(); });

        act(() => { result.current.undoDiscard(); });

        await waitFor(() => {
            expect(kernel.readPlans().map((plan) => plan.label)).toEqual(['Half written']);
        });
        expect(result.current.lastDiscarded).toBeNull();
    });

    it('says nothing when what was open is what is being opened', async () => {
        const { factory } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.name).toBe('My mean'); });

        act(() => { result.current.startAnew(); });

        expect(result.current.lastDiscarded).toBeNull();
    });
});

describe('deleting a reading', () => {
    it('offers it straight back, rather than asking before it goes', async () => {
        // How this chart treats every other removal: a confirmation asks about
        // work the reader has not lost yet, an undo answers about work they have.
        const { factory } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await act(async () => { await result.current.save(); });

        act(() => { result.current.remove(); });

        expect(result.current.lastDiscarded?.name).toBe('My mean');
        expect(kernel.container.addons.list()).toEqual([]);
    });

    it('puts it back on the shelf and on the chart when undone', async () => {
        const { factory } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await act(async () => { await result.current.save(); });
        act(() => { result.current.remove(); });

        act(() => { result.current.undoDiscard(); });

        await waitFor(() => { expect(kernel.container.addons.list()).toHaveLength(1); });
        expect(result.current.name).toBe('My mean');
        expect(result.current.lastDiscarded).toBeNull();
    });

    it('puts back a reading that was not the starter, which is every real one', async () => {
        // The undo after a deletion offers the work back and files it again.
        // Recorded and then recorded over by the load that follows, it came
        // back to the editor and never came back to the shelf.
        const { factory, type } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        act(() => { type(sourceNamed('Mine')); });
        await act(async () => { await result.current.save(); });
        act(() => { result.current.remove(); });

        act(() => { result.current.undoDiscard(); });

        await waitFor(() => { expect(kernel.container.addons.list()).toHaveLength(1); });
    });

    it('puts back the code it deleted, not the starter it was replaced with', async () => {
        const { factory, type } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        act(() => { type(sourceNamed('Mine')); });
        await act(async () => { await result.current.save(); });
        act(() => { result.current.remove(); });

        act(() => { result.current.undoDiscard(); });

        await waitFor(() => { expect(kernel.container.addons.list()).toHaveLength(1); });
        const [filed] = kernel.container.addons.list();
        const rebuilt = buildAddon(filed?.compiled ?? {});
        expect(rebuilt.kind === 'ready' ? rebuilt.indicator.label : null).toBe('Mine');
    });

    it('stops offering it once the moment has passed', async () => {
        vi.useFakeTimers();
        try {
            const { factory } = buildFakeEditor();
            const { result } = renderEditor(factory);
            await act(async () => { await result.current.save(); });
            act(() => { result.current.remove(); });

            act(() => { vi.advanceTimersByTime(8_000); });

            expect(result.current.lastDiscarded).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('takes it off the shelf, off the chart, and out of the catalogue', async () => {
        const { factory } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await act(async () => { await result.current.save(); });
        await waitFor(() => { expect(kernel.readPlans()).toHaveLength(1); });

        act(() => { result.current.remove(); });

        await waitFor(() => { expect(kernel.container.addons.list()).toEqual([]); });
        expect(kernel.readAdded().map((entry) => entry.indicatorId))
            .not.toContain(`${ADDON_ID_PREFIX}my-mean`);
    });
});

describe('opening a bundle somebody handed over', () => {
    async function importText(text: string, called = 'theirs.fathom.json') {
        const { factory, buffer } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });

        await act(async () => {
            await result.current.importFile(new File([text], called, { type: 'application/json' }));
        });

        return { result, buffer };
    }

    it('opens one that holds a whole reading', async () => {
        const bundle = JSON.stringify({ fathom: 1, name: 'Theirs', files: { 'main.ts': 'the entry' } });

        const { result, buffer } = await importText(bundle);

        expect(result.current.name).toBe('Theirs');
        expect(buffer()).toBe('the entry');
    });

    it('is called what it was brought in as, not what it replaced', async () => {
        // The name is set by the caller and then read back after a compile.
        // Read out of the render before that call, the reading was named after
        // the one it had just replaced.
        const bundle = JSON.stringify({ fathom: 1, name: 'Theirs', files: { 'main.ts': sourceNamed('Their label') } });

        const { result } = await importText(bundle);

        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
        expect(result.current.name).toBe('Theirs');
    });

    it('says it is unsaved, because it is on no shelf', async () => {
        // The one signal a reader has about whether it is safe to close the
        // panel. Work that came from a file has never been filed anywhere.
        const bundle = JSON.stringify({ fathom: 1, name: 'Theirs', files: { 'main.ts': 'the entry' } });

        const { result } = await importText(bundle);

        expect(result.current.isUnsaved).toBe(true);
    });

    it('refuses one with no entry rather than opening a buffer nothing can save', async () => {
        // The editor showed a Monaco buffer of its own that `readFiles` could
        // never see: everything typed into it was invisible to save and draft.
        // Refused outright, what the reader had stays where it was.
        const bundle = JSON.stringify({ fathom: 1, files: { 'helpers.ts': 'no entry here' } });

        const { result, buffer } = await importText(bundle);

        expect(result.current.files).toEqual([ENTRY_FILE]);
        expect(buffer()).toBe(STARTER[ENTRY_FILE]);
    });

    it('refuses one whose paths climb out of the reading', async () => {
        const bundle = JSON.stringify({
            fathom: 1,
            files: { 'main.ts': 'the entry', '../escape.ts': 'elsewhere' },
        });

        const { result } = await importText(bundle);

        expect(result.current.files).not.toContain('../escape.ts');
    });
});

describe('a draft left behind by one reading', () => {
    it('is not offered to another one being opened', async () => {
        // A draft belongs to the reading it was typed into. Offered to
        // whichever one was opened next, it showed under that one's name — and
        // saving filed it over the reading it was named after.
        const first = buildFakeEditor();
        const opened = renderEditor(first.factory);
        act(() => { first.type(sourceNamed('Mine')); });
        await act(async () => { await opened.result.current.save(); });
        const mine = opened.result.current.openKey!;
        act(() => { opened.result.current.startAnew(); });
        act(() => { first.type(sourceNamed('Yours')); });
        await act(async () => { await opened.result.current.save(); });
        const yours = opened.result.current.openKey!;
        act(() => { opened.result.current.open(mine); });
        act(() => { first.type(sourceNamed('Mine, half rewritten')); });
        await waitFor(() => { expect(opened.result.current.isUnsaved).toBe(true); });
        opened.unmount();

        const second = buildFakeEditor();
        const reopened = renderEditor(second.factory, yours, opened.kernel);

        await waitFor(() => { expect(reopened.result.current.status?.kind).toBe('ready'); });
        expect(second.buffer()).toBe(sourceNamed('Yours'));
        expect(reopened.result.current.name).toBe('Yours');
    });

    it('is still offered back to the reading it does belong to', async () => {
        const first = buildFakeEditor();
        const opened = renderEditor(first.factory);
        act(() => { first.type(sourceNamed('Mine')); });
        await act(async () => { await opened.result.current.save(); });
        const mine = opened.result.current.openKey!;
        act(() => { first.type(sourceNamed('Mine, half rewritten')); });
        await waitFor(() => { expect(opened.result.current.isUnsaved).toBe(true); });
        opened.unmount();

        const second = buildFakeEditor();
        renderEditor(second.factory, mine, opened.kernel);

        await waitFor(() => { expect(second.buffer()).toBe(sourceNamed('Mine, half rewritten')); });
    });
});

describe('a reading written across several files', () => {
    it('starts as one, so nothing is decided for a reader who wants one', async () => {
        const { factory } = buildFakeEditor();

        const { result } = renderEditor(factory);

        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
        expect(result.current.files).toEqual([ENTRY_FILE]);
    });

    it('shows the file it has just added, rather than leaving the reader to find it', async () => {
        const { factory } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });

        act(() => { result.current.addFile('helpers.ts'); });

        expect(result.current.files).toEqual([ENTRY_FILE, 'helpers.ts']);
        expect(result.current.shownFile).toBe('helpers.ts');
    });

    it('says why rather than quietly doing nothing when a name is taken', async () => {
        const { factory } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
        act(() => { result.current.addFile('helpers.ts'); });

        let refusal: string | null = null;
        act(() => { refusal = result.current.addFile('helpers.ts'); });

        expect(refusal).toMatch(/already has a helpers\.ts/);
    });

    it('files a source and a build that came from the same instant', async () => {
        // Read a moment apart, a keystroke landing between them filed source
        // beside a build of something else — and the next reload drew
        // arithmetic that was nowhere in the file the editor showed.
        const { factory, type } = buildFakeEditor(30);
        const { kernel, result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });

        const filing = act(async () => { await result.current.save(); });
        act(() => { type(sourceNamed('Typed while it compiled')); });
        await filing;

        const [filed] = kernel.container.addons.list();
        const rebuilt = buildAddon(filed?.compiled ?? {});
        const named = rebuilt.kind === 'ready' ? rebuilt.indicator.label : null;
        expect(filed?.files[ENTRY_FILE]).toBe(sourceNamed(named ?? 'nothing'));
    });

    it('files every file, so a reload opens the whole reading', async () => {
        const { factory, typeInto } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
        act(() => { result.current.addFile('helpers.ts'); });
        act(() => { typeInto('helpers.ts', 'exports.mean = 1;'); });

        await act(async () => { await result.current.save(); });

        const [filed] = kernel.container.addons.list();
        expect(Object.keys(filed?.files ?? {}).sort()).toEqual(['helpers.ts', ENTRY_FILE]);
    });

    it('opens a saved reading back into all of its files', async () => {
        const { factory, typeInto } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
        act(() => { result.current.addFile('helpers.ts'); });
        act(() => { typeInto('helpers.ts', 'exports.mean = 1;'); });
        await act(async () => { await result.current.save(); });
        const key = result.current.openKey!;
        act(() => { result.current.startAnew(); });

        act(() => { result.current.open(key); });

        await waitFor(() => { expect(result.current.files).toEqual([ENTRY_FILE, 'helpers.ts']); });
    });

    it('offers a removed file back, since one can hold as much work as a reading', async () => {
        // The cross that takes a file away sits against the tab that opens it,
        // and nothing asked. Every other removal here is offered back.
        const { factory, typeInto } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
        act(() => { result.current.addFile('helpers.ts'); });
        act(() => { typeInto('helpers.ts', 'a morning of work'); });
        act(() => { result.current.removeFile('helpers.ts'); });

        act(() => { result.current.undoFileRemoval(); });

        expect(result.current.files).toEqual([ENTRY_FILE, 'helpers.ts']);
        expect(result.current.shownFile).toBe('helpers.ts');
    });

    it('stops offering it once the moment has passed', async () => {
        vi.useFakeTimers();
        try {
            const { factory } = buildFakeEditor();
            const { result } = renderEditor(factory);
            await vi.waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
            act(() => { result.current.addFile('helpers.ts'); });
            act(() => { result.current.removeFile('helpers.ts'); });
            expect(result.current.lastRemovedFile).toBe('helpers.ts');

            act(() => { vi.advanceTimersByTime(8_000); });

            expect(result.current.lastRemovedFile).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the reader in the entry when the file they were in goes', async () => {
        const { factory } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });
        act(() => { result.current.addFile('helpers.ts'); });

        act(() => { result.current.removeFile('helpers.ts'); });

        expect(result.current.files).toEqual([ENTRY_FILE]);
        expect(result.current.shownFile).toBe(ENTRY_FILE);
    });
});
