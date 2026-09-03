import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { ADDON_ID_PREFIX, forgetAddon, listAddons } from '../../../../src/app/addons/addon-registry.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { type EditorFactory, type SourceEditor, useAddonEditor } from '../../../../src/app/react/use-addon-editor.ts';
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
            return { compiled: source, faults: [] };
        },
        showRuntimeFault: () => undefined,
        applyTheme: () => undefined,
    };
    const factory: EditorFactory = (config) => { onChange = config.onChange; return editor; };
    return {
        factory,
        type: (next: string): void => { source = next; onChange(); },
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

function renderEditor(factory: EditorFactory, openOn?: string) {
    const kernel = createIndicatorKernel([]);
    const wrapper = ({ children }: { readonly children: ReactNode }): ReactElement => (
        <KernelProvider container={kernel.container}>{children}</KernelProvider>
    );
    const rendered = renderHook(
        () => useAddonEditor({ starter: STARTER, openOn, buildEditor: factory }),
        { wrapper },
    );
    act(() => { rendered.result.current.mountInto(document.createElement('div')); });
    return { kernel, ...rendered };
}

describe('opening the editor', () => {
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

describe('putting a saved reading back', () => {
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

describe('deleting a reading', () => {
    it('offers it straight back, rather than asking before it goes', async () => {
        // How this chart treats every other removal: a confirmation asks about
        // work the reader has not lost yet, an undo answers about work they have.
        const { factory } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await act(async () => { await result.current.save(); });

        act(() => { result.current.remove(); });

        expect(result.current.lastRemoved?.name).toBe('My mean');
        expect(kernel.container.addons.list()).toEqual([]);
    });

    it('puts it back on the shelf and on the chart when undone', async () => {
        const { factory } = buildFakeEditor();
        const { kernel, result } = renderEditor(factory);
        await act(async () => { await result.current.save(); });
        act(() => { result.current.remove(); });

        act(() => { result.current.undoRemoval(); });

        await waitFor(() => { expect(kernel.container.addons.list()).toHaveLength(1); });
        expect(result.current.name).toBe('My mean');
        expect(result.current.lastRemoved).toBeNull();
    });

    it('stops offering it once the moment has passed', async () => {
        vi.useFakeTimers();
        try {
            const { factory } = buildFakeEditor();
            const { result } = renderEditor(factory);
            await act(async () => { await result.current.save(); });
            act(() => { result.current.remove(); });

            act(() => { vi.advanceTimersByTime(8_000); });

            expect(result.current.lastRemoved).toBeNull();
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
