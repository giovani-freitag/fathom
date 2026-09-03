import { useCallback, useEffect, useRef, useState } from 'react';
import { type AddonBuild, buildAddon } from '../addons/addon-runtime.ts';
import { AddonEditorService, type SourceFault } from '../services/addon-editor/addon-editor-service.ts';
import type { SavedReading } from '../services/addon-library/addon-library-service.ts';
import { forgetAddon, registerAddon } from '../addons/addon-registry.ts';
import { readLayerDefaults } from '../indicators/indicator-catalogue.ts';
import { useAppearance } from './use-appearance.ts';
import { useChartSlice } from './use-chart-state.ts';
import { useKernel } from './kernel-context.ts';
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
    readonly save: () => void;
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
 * Drives the in-page editor and puts what it produces on the chart.
 *
 * @param starter - What a reader with an empty shelf opens on.
 * @param openOn - A saved reading to open, where the reader picked one.
 * @returns Where to mount, what to say about it, and what can be done to it.
 */
export function useAddonEditor(starter: string, openOn?: string): AddonEditorControls {
    const kernel = useKernel();
    const library = kernel.addons;
    const { resolvedTheme } = useAppearance();
    const [status, setStatus] = useState<EditorStatus | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [saved, setSaved] = useState<readonly SavedReading[]>(() => library.list());
    const [openKey, setOpenKey] = useState<string | null>(() => opening(library, openOn)?.key ?? null);
    const [name, setName] = useState<string>(() => opening(library, openOn)?.name ?? UNTITLED);
    const [isUnsaved, setIsUnsaved] = useState(false);
    // The reading may throw while the chart draws it rather than while it is
    // built, and that is the failure a compiler cannot warn about.
    const drawFailure = useChartSlice((state) => {
        const drawn = state.addedIndicators.find((entry) => entry.indicatorId === liveId(openKey));
        return drawn === undefined ? null : state.layerFailures[drawn.instanceId] ?? null;
    });
    const serviceRef = useRef<AddonEditorService | null>(null);
    const compiledRef = useRef('');
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
    }, [kernel]);

    const rebuild = useCallback(async (): Promise<void> => {
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
            publish(openKey ?? 'draft', buildAddon(compiled));
        } finally {
            setIsRunning(false);
        }
    }, [openKey, publish]);

    const mountInto = useCallback((node: HTMLDivElement | null): void => {
        if (node === null) {
            return;
        }
        const service = new AddonEditorService({
            onChange: () => { void rebuild(); },
            theme: themeRef.current,
        });
        serviceRef.current = service;
        service.mount(node, opening(library, openOn)?.source ?? starter);
        void rebuild();
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

    const save = useCallback((): void => {
        const service = serviceRef.current;
        if (service === null) {
            return;
        }
        const key = openKey ?? library.mintKey(name);
        library.save({ key, name, source: service.readSource(), compiled: compiledRef.current });
        setOpenKey(key);
        setSaved(library.list());
        setIsUnsaved(false);
    }, [library, name, openKey]);

    const load = useCallback((source: string, key: string | null, called: string): void => {
        serviceRef.current?.replaceSource(source);
        setOpenKey(key);
        setName(called);
        setIsUnsaved(false);
        void rebuild();
    }, [rebuild]);

    const open = useCallback((key: string): void => {
        const found = library.find(key);
        if (found !== null) {
            load(found.source, found.key, found.name);
        }
    }, [library, load]);

    const startAnew = useCallback((): void => { load(starter, null, UNTITLED); }, [load, starter]);

    const remove = useCallback((): void => {
        if (openKey !== null) {
            library.remove(openKey);
            forgetAddon(liveId(openKey));
            kernel.chart.updateIndicators(
                (current) => current.filter((entry) => entry.indicatorId !== liveId(openKey)),
            );
            setSaved(library.list());
        }
        load(starter, null, UNTITLED);
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
        rename: (called) => { setName(called); setIsUnsaved(true); },
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
