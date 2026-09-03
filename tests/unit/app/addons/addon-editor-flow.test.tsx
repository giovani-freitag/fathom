import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { ADDON_ID_PREFIX, forgetAddon, listAddons } from '../../../../src/app/addons/addon-registry.ts';
import { buildAddon } from '../../../../src/app/addons/addon-runtime.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { type EditorFactory, type SourceEditor, useAddonEditor } from '../../../../src/app/react/use-addon-editor.ts';
import { AddonLibraryService } from '../../../../src/app/services/addon-library/addon-library-service.ts';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';

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

const STARTER = sourceNamed('My mean');

/**
 * An editor with no browser behind it.
 *
 * `compile` is deliberately slow so a test can press save before it lands,
 * which is the order that filed a reading with no compiled body at all.
 */
function buildFakeEditor(settleMs = 0) {
    let source = '';
    let onChange = (): void => undefined;
    const editor: SourceEditor = {
        mount: (_host, opening) => { source = opening; },
        unmount: () => undefined,
        readSource: () => source,
        replaceSource: (next) => { source = next; },
        compile: async () => {
            // Only ever a timer when a test asked for one, so a test that
            // freezes the clock does not also freeze the compiler.
            if (settleMs > 0) {
                await new Promise((resolve) => { setTimeout(resolve, settleMs); });
            }
            // The fake is its own compiler: the source is already the emitted
            // shape, so what a test writes is what the runtime is handed.
            if (isRefusing) {
                throw new Error('the compiler never answered');
            }
            if (isFaulting) {
                return { compiled: '', faults: [{ message: 'no', line: 1, column: 1 }] };
            }
            return { compiled: source, faults: [] };
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
        return editor;
    };
    return {
        factory,
        type: (next: string): void => { source = next; onChange(); },
        /** What Ctrl+S does, as the editor would fire it. */
        pressSave: (): void => { onSave(); },
        /** Makes every compile report a fault, as a typo would. */
        faultFrom: (): void => { isFaulting = true; },
        /** Makes the compiler itself refuse, as one not yet started does. */
        refuseFrom: (): void => { isRefusing = true; },
        /** What is actually in the editor, which a refusal must not disturb. */
        buffer: (): string => source,
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

    it('says so when the compiler itself never answers', async () => {
        // Left uncaught, the panel sat on "Starting…" for the rest of the
        // session and the only trace was a rejection in the console.
        const { factory, refuseFrom, type } = buildFakeEditor();
        const { result } = renderEditor(factory);
        await waitFor(() => { expect(result.current.status?.kind).toBe('ready'); });

        refuseFrom();
        act(() => { type(STARTER); });

        await waitFor(() => { expect(result.current.status?.kind).toBe('broken'); });
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
        const rebuilt = buildAddon(filed?.compiled ?? '');
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
