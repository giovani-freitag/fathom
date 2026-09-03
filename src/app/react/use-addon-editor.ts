import { useCallback, useEffect, useRef, useState } from 'react';
import { type AddonBuild, buildAddon } from '../addons/addon-runtime.ts';
import type { SourceFault } from '../services/addon-editor/addon-editor-service.ts';
import type { SavedReading } from '../services/addon-library/addon-library-service.ts';
import { forgetAddon, registerAddon } from '../addons/addon-registry.ts';
import { readLayerDefaults } from '../indicators/indicator-catalogue.ts';
import { useAppearance } from './use-appearance.ts';
import { useChartSlice } from './use-chart-state.ts';
import { useKernel } from './kernel-context.ts';
import type { AddedIndicator } from '../../shared/core/indicator-selection.ts';
import type { Indicator } from '../../shared/core/draw-plan.ts';
import { withIndicatorAdded } from '../../shared/core/indicator-selection.ts';

/** What the panel shows about the script as it stands. */
export type EditorStatus =
    | { readonly kind: 'ready'; readonly label: string }
    | { readonly kind: 'faulted'; readonly faults: readonly SourceFault[] }
    | { readonly kind: 'broken'; readonly message: string };

export interface AddonEditorControls {
    /** Where to mount the editor. */
    readonly mountInto: (node: HTMLDivElement | null) => void;
    readonly status: EditorStatus | null;
    readonly isRunning: boolean;
    /** What the open reading is called, which the reader can change. */
    readonly name: string;
    readonly rename: (name: string) => void;
    /** True where what is open differs from what is on the shelf. */
    readonly isUnsaved: boolean;
    readonly saved: readonly SavedReading[];
    /** Which saved reading is open, or null for one never saved. */
    readonly openKey: string | null;
    /** What the reading threw while the chart drew it, where it did. */
    readonly drawFailure: string | null;
    readonly save: () => Promise<void>;
    readonly open: (key: string) => void;
    readonly startAnew: () => void;
    readonly remove: () => void;
    /** Hands the reader the open script as a file. */
    readonly exportFile: () => void;
    readonly importFile: (file: File) => Promise<void>;
}

/** What a reading is called before the reader has said. */
const UNTITLED = 'Untitled reading';

/**
 * The editor itself, as this hook needs it.
 *
 * An interface rather than the class because the class carries a compiler and a
 * canvas, neither of which exists outside a browser — and the order this hook
 * does things in is exactly what was getting them wrong.
 */
export interface SourceEditor {
    mount: (host: HTMLElement, source: string) => void;
    unmount: () => void;
    readSource: () => string;
    replaceSource: (source: string) => void;
    compile: () => Promise<{ readonly compiled: string; readonly faults: readonly SourceFault[] }>;
    showRuntimeFault: (fault: { readonly message: string; readonly line?: number } | null) => void;
    applyTheme: (theme: 'dark' | 'light') => void;
}

/** How the editor is built. Replaced by a test that has no browser. */
export type EditorFactory = (config: {
    onChange: () => void;
    theme: 'dark' | 'light';
}) => SourceEditor;

export interface AddonEditorRequest {
    /** What a reader with an empty shelf opens on. */
    readonly starter: string;
    /** A saved reading to open, where the reader picked one. */
    readonly openOn?: string | undefined;
    /**
     * How to make the editor.
     *
     * Passed in, so this file needs no compiler and a test needs no browser.
     */
    readonly buildEditor: EditorFactory;
}

/**
 * Drives the in-page editor and puts what it produces on the chart.
 *
 * @param request - What to open on, and what to open it with.
 * @returns Where to mount, what to say about it, and what can be done to it.
 */
export function useAddonEditor(request: AddonEditorRequest): AddonEditorControls {
    const { starter, openOn, buildEditor } = request;
    const kernel = useKernel();
    const library = kernel.addons;
    const { resolvedTheme } = useAppearance();
    const [status, setStatus] = useState<EditorStatus | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [saved, setSaved] = useState<readonly SavedReading[]>(() => library.list());
    const [openKey, setOpenKey] = useState<string | null>(() => opening(library, openOn)?.key ?? null);
    const [name, setName] = useState<string>(() => opening(library, openOn)?.name ?? UNTITLED);
    const [isUnsaved, setIsUnsaved] = useState(false);
    // Until the reader types a name of their own, the reading is called what its
    // own code says it is called. Two names for one thing is one too many: the
    // chart draws the label, and a file called something else is a second name
    // nobody asked for.
    const [isNamedByHand, setIsNamedByHand] = useState(false);
    // The reading may throw while the chart draws it rather than while it is
    // built, and that is the failure a compiler cannot warn about.
    const drawFailure = useChartSlice((state) => {
        const drawn = state.addedIndicators.find((entry) => entry.indicatorId === liveId(openKey));
        return drawn === undefined ? null : state.layerFailures[drawn.instanceId] ?? null;
    });
    const serviceRef = useRef<SourceEditor | null>(null);
    const compiledRef = useRef('');
    const rebuildRef = useRef<() => Promise<void>>(() => Promise.resolve());
    const themeRef = useRef(resolvedTheme);

    const publish = useCallback((key: string, build: AddonBuild): void => {
        const service = serviceRef.current;
        if (build.kind === 'failed') {
            setStatus({ kind: 'broken', message: build.message });
            service?.showRuntimeFault(build);
            return;
        }

        service?.showRuntimeFault(null);
        const id = registerAddon(key, build.indicator);
        setStatus({ kind: 'ready', label: build.indicator.label });
        if (!isNamedByHand) {
            setName(build.indicator.label);
        }
        kernel.chart.updateIndicators((current) => (
            current.some((entry) => entry.indicatorId === id)
                // Rebuilt in place: a new array is what makes the chart run the
                // reading again, and the reader keeps the copy they tuned.
                ? [...current]
                : withIndicatorAdded({
                    added: current,
                    indicatorId: id,
                    settings: readLayerDefaults(build.indicator),
                    tone: 'phosphor',
                    isRepeatable: false,
                })
        ));
    }, [isNamedByHand, kernel]);

    const rebuild = useCallback(async (underKey: string | null): Promise<void> => {
        const service = serviceRef.current;
        if (service === null) {
            return;
        }
        setIsUnsaved(true);
        setIsRunning(true);
        try {
            const { compiled, faults } = await service.compile();
            if (faults.length > 0) {
                setStatus({ kind: 'faulted', faults });
                return;
            }
            compiledRef.current = compiled;
            publish(underKey ?? 'draft', buildAddon(compiled));
        } finally {
            setIsRunning(false);
        }
    }, [publish]);

    // The editor is mounted once and lives on; what it calls back into must be
    // the current one, not the one that existed when it was created.
    useEffect(() => { rebuildRef.current = () => rebuild(openKey); });

    const mountInto = useCallback((node: HTMLDivElement | null): void => {
        if (node === null) {
            serviceRef.current?.unmount();
            serviceRef.current = null;
            return;
        }
        const service = buildEditor({
            onChange: () => { void rebuildRef.current(); },
            theme: themeRef.current,
        });
        serviceRef.current = service;
        service.mount(node, opening(library, openOn)?.source ?? starter);
        void rebuildRef.current();
        // Opening does not count as an edit, whatever the mount did to the model.
        setIsUnsaved(false);
    // Mounted once. Rebuilding on every change of `rebuild` would tear the
    // editor down and put it back mid-keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => () => {
        serviceRef.current?.unmount();
        serviceRef.current = null;
    }, []);

    // The editor is not React's to re-render, so a change of palette has to be
    // handed to it rather than described in the markup. The ref carries it to a
    // remount, which happens outside this effect's reach.
    useEffect(() => {
        themeRef.current = resolvedTheme;
        serviceRef.current?.applyTheme(resolvedTheme);
    }, [resolvedTheme]);

    const save = useCallback(async (): Promise<void> => {
        const service = serviceRef.current;
        if (service === null) {
            return;
        }
        // Compiled here rather than taken from the last run: the two are
        // written together and one is derived from the other, so a save that
        // caught them apart stored a reading that would not come back.
        const { compiled } = await service.compile();
        compiledRef.current = compiled === '' ? compiledRef.current : compiled;
        // The name is taken from the reading itself unless the reader has typed
        // one, and taken here rather than from state: pressing save before the
        // first compile had landed filed the reading under `Untitled`.
        const built = buildAddon(compiledRef.current);
        const called = isNamedByHand || built.kind !== 'ready' ? name : built.indicator.label;
        const key = openKey ?? library.mintKey(called);
        library.save({ key, name: called, source: service.readSource(), compiled: compiledRef.current });
        if (openKey === null && built.kind === 'ready') {
            adoptDraft(kernel, key, built.indicator);
        }
        setName(called);
        setOpenKey(key);
        setSaved(library.list());
        setIsUnsaved(false);
    }, [isNamedByHand, kernel, library, name, openKey]);

    const load = useCallback((source: string, key: string | null, called: string | null): void => {
        serviceRef.current?.replaceSource(source);
        setOpenKey(key);
        setIsNamedByHand(called !== null);
        setName(called ?? UNTITLED);
        setIsUnsaved(false);
        // The key is handed over rather than read back: this runs before the
        // state settles, and publishing under the key being left behind put the
        // reading back on the chart the moment it was deleted.
        void rebuild(key);
    }, [rebuild]);

    const open = useCallback((key: string): void => {
        const found = library.find(key);
        if (found !== null) {
            load(found.source, found.key, found.name);
        }
    }, [library, load]);

    const startAnew = useCallback((): void => { load(starter, null, null); }, [load, starter]);

    const remove = useCallback((): void => {
        if (openKey !== null) {
            library.remove(openKey);
            forgetAddon(liveId(openKey));
            kernel.chart.updateIndicators(
                (current) => current.filter((entry) => entry.indicatorId !== liveId(openKey)),
            );
            setSaved(library.list());
        }
        load(starter, null, null);
    }, [kernel, library, load, openKey, starter]);

    const exportFile = useCallback((): void => {
        const source = serviceRef.current?.readSource() ?? '';
        downloadAsFile(`${name.replace(/[^\w.-]+/g, '-') || 'reading'}.ts`, source);
    }, [name]);

    const importFile = useCallback(async (file: File): Promise<void> => {
        load(await file.text(), null, file.name.replace(/\.[jt]s$/, ''));
    }, [load]);

    return {
        mountInto,
        openKey,
        drawFailure,
        status,
        isRunning,
        name,
        rename: (called) => { setName(called); setIsNamedByHand(true); setIsUnsaved(true); },
        isUnsaved,
        saved,
        save,
        open,
        startAnew,
        remove,
        exportFile,
        importFile,
    };
}

/**
 * Moves the copy on the chart from the unsaved id onto the saved one.
 *
 * Without it, saving leaves the draft where it was and adds a second copy
 * beside it: the reader sees their reading drawn twice, and removing one of
 * them removes the wrong one.
 *
 * @param kernel - The services the chart runs on.
 * @param key - What the reading has just been filed under.
 * @param indicator - The reading itself, to register under the new id.
 */
function adoptDraft(
    kernel: { chart: { updateIndicators: (revise: (current: readonly AddedIndicator[]) => readonly AddedIndicator[]) => void } },
    key: string,
    indicator: Indicator,
): void {
    const from = liveId(null);
    const to = liveId(key);
    registerAddon(key, indicator);
    forgetAddon(from);
    kernel.chart.updateIndicators((current) => current.map((entry) => (
        entry.indicatorId === from ? { ...entry, indicatorId: to } : entry
    )));
}

/** The id a saved reading is registered under while it is on the chart. */
function liveId(key: string | null): string {
    return `addon:${key ?? 'draft'}`;
}

/**
 * The reading to open on: the one asked for, else the last one saved.
 *
 * @param library - Where the readings are kept.
 * @param wanted - A key the reader picked, where they picked one.
 * @returns What to show, or null for an empty shelf.
 */
function opening(
    library: { find: (key: string) => SavedReading | null; list: () => readonly SavedReading[] },
    wanted: string | undefined,
): SavedReading | null {
    return (wanted === undefined ? null : library.find(wanted)) ?? library.list()[0] ?? null;
}

/**
 * Hands the reader a file without asking a server for it.
 *
 * @param filename - What to call it.
 * @param text - What goes in it.
 */
function downloadAsFile(filename: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
