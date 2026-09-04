import { useCallback, useEffect, useRef, useState } from 'react';
import { type AddonBuild, buildAddon } from '../addons/addon-runtime.ts';
import type { SourceFault } from '../services/addon-editor/addon-editor-service.ts';
import type { SavedReading } from '../services/addon-library/addon-library-service.ts';
import { ADDON_ID_PREFIX, forgetAddon, registerAddon, UNSAVED_ADDON_ID } from '../addons/addon-registry.ts';
import { readLayerDefaults } from '../indicators/indicator-catalogue.ts';
import { useAppearance, useTranslate } from './use-appearance.ts';
import { useChartSlice } from './use-chart-state.ts';
import { useKernel } from './kernel-context.ts';
import type { AddedIndicator } from '../../shared/core/indicator-selection.ts';
import type { Indicator } from '../../shared/core/draw-plan.ts';
import { withIndicatorAdded } from '../../shared/core/indicator-selection.ts';
import { ENTRY_FILE, type ReadingFiles } from '../../shared/core/reading-files.ts';

/**
 * Work that has just left the editor, and can still be had back.
 *
 * Deleting is not the only way to lose a script: starting a new one, opening
 * another and importing a file all replace what was there, and none of them
 * asks. What they share is that a reader can want it back within seconds.
 */
export interface DiscardedWork {
    readonly name: string;
    readonly files: ReadingFiles;
    /** The shelf entry it came from, where it had one. */
    readonly key: string | null;
    /** True where it also left the shelf, and undoing has to put it back. */
    readonly wasDeleted: boolean;
}

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
    /** What just left the editor, for as long as it can be had back. */
    readonly lastDiscarded: DiscardedWork | null;
    readonly undoDiscard: () => void;
    /** Hands the reader the open script as a file. */
    readonly exportFile: () => void;
    readonly importFile: (file: File) => Promise<void>;
    /** Opens a reading brought in from a repository or a package. */
    readonly openBroughtIn: (files: ReadingFiles, name: string) => void;
    /** The paths in the open reading, and which one is shown. */
    readonly files: readonly string[];
    readonly shownFile: string;
    readonly showFile: (path: string) => void;
    /** Adds, moves or removes a file. Answers with what went wrong, or null. */
    readonly addFile: (path: string) => string | null;
    readonly renameFile: (from: string, to: string) => string | null;
    readonly removeFile: (path: string) => void;
}

/** How long a deleted reading can still be had back. */
const REMOVAL_GRACE_MS = 7_000;

/**
 * The most an imported file may weigh.
 *
 * Generous for a reading and small enough that a file picked by mistake cannot
 * hang the tab tokenising it.
 */
const LARGEST_IMPORT_BYTES = 256 * 1024;

/**
 * The editor itself, as this hook needs it.
 *
 * An interface rather than the class because the class carries a compiler and a
 * canvas, neither of which exists outside a browser — and the order this hook
 * does things in is exactly what was getting them wrong.
 */
export interface SourceEditor {
    mount: (host: HTMLElement, files: ReadingFiles) => void;
    unmount: () => void;
    readFiles: () => ReadingFiles;
    listFiles: () => readonly string[];
    shownFile: () => string;
    replaceFiles: (files: ReadingFiles) => void;
    showFile: (path: string) => void;
    addFile: (path: string) => void;
    removeFile: (path: string) => void;
    renameFile: (from: string, to: string) => void;
    compile: () => Promise<{ readonly compiled: ReadingFiles; readonly faults: readonly SourceFault[] }>;
    showRuntimeFault: (
        fault: { readonly message: string; readonly line?: number; readonly file?: string } | null,
    ) => void;
    applyTheme: (theme: 'dark' | 'light') => void;
}

/** How the editor is built. Replaced by a test that has no browser. */
export type EditorFactory = (config: {
    onChange: () => void;
    theme: 'dark' | 'light';
    onSave: () => void;
    onLeave: () => void;
    ariaLabel: string;
}) => SourceEditor;

export interface AddonEditorRequest {
    /** What a reader with an empty shelf opens on. */
    readonly starter: ReadingFiles;
    /** Where the keyboard goes when the reader asks to leave the editor. */
    readonly onLeave: () => void;
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
    const { starter, openOn, buildEditor, onLeave } = request;
    const kernel = useKernel();
    const library = kernel.addons;
    const { locale, resolvedTheme } = useAppearance();
    const translate = useTranslate();
    const untitled = translate('editor.untitled');
    const shelfRefusedMessage = translate('editor.shelfRefused');
    const importTooLargeMessage = translate('editor.tooLarge');
    const compilerLostMessage = translate('editor.compilerLost');
    const importNotTextMessage = translate('editor.notText');
    const importNotBundleMessage = translate('editor.notBundle');
    const editorLabel = translate('editor.code');
    const [status, setStatus] = useState<EditorStatus | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [saved, setSaved] = useState<readonly SavedReading[]>(() => library.list());
    const [openKey, setOpenKey] = useState<string | null>(() => opening(library, openOn)?.key ?? null);
    const [name, setName] = useState<string>(() => opening(library, openOn)?.name ?? untitled);
    const [isUnsaved, setIsUnsaved] = useState(false);
    // Until the reader types a name of their own, the reading is called what its
    // own code says it is called. Two names for one thing is one too many: the
    // chart draws the label, and a file called something else is a second name
    // nobody asked for.
    const [isNamedByHand, setIsNamedByHand] = useState(false);
    const [lastDiscarded, setLastDiscarded] = useState<DiscardedWork | null>(null);
    // The reading may throw while the chart draws it rather than while it is
    // built, and that is the failure a compiler cannot warn about.
    const drawFailure = useChartSlice((state) => {
        const drawn = state.addedIndicators.find((entry) => entry.indicatorId === liveId(openKey));
        return drawn === undefined ? null : state.layerFailures[drawn.instanceId] ?? null;
    });
    const serviceRef = useRef<SourceEditor | null>(null);
    const compiledRef = useRef<ReadingFiles>({});
    const rebuildRef = useRef<() => Promise<void>>(() => Promise.resolve());
    const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
    const leaveRef = useRef<() => void>(() => undefined);
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

    const rebuild = useCallback(async (underKey: string | null, isEdit = true): Promise<void> => {
        const service = serviceRef.current;
        if (service === null) {
            return;
        }
        // Opening a reading is not editing it. Marked either way, the one signal
        // a reader has about whether their work is safe was wrong from the first
        // moment of every open.
        if (isEdit) {
            setIsUnsaved(true);
        }
        library.rememberDraft(service.readFiles());
        setIsRunning(true);
        try {
            const { compiled, faults } = await service.compile();
            // The editor may have been taken down while the compiler worked —
            // a remount, a close. What it answered belongs to an editor that is
            // no longer there, and publishing it puts an empty reading on the
            // chart over whatever the live one has just built.
            if (serviceRef.current !== service) {
                return;
            }
            if (faults.length > 0) {
                setStatus({ kind: 'faulted', faults });
                return;
            }
            compiledRef.current = compiled;
            publish(underKey ?? 'draft', buildAddon(compiled));
        } catch {
            // Only the compiler itself can land here — a fault in the reader's
            // own script is a fault, not a refusal. Left uncaught it says
            // nothing at all, and the panel waits on a build that will not come.
            setStatus({ kind: 'broken', message: compilerLostMessage });
        } finally {
            setIsRunning(false);
        }
    }, [compilerLostMessage, library, publish]);

    // A reading may name itself in the reader's language, and the name it
    // picked was picked when it was built. The draft is not in the shelf the
    // host rebuilds from, so it is built again here.
    const builtSpeaking = useRef(locale);
    useEffect(() => {
        if (builtSpeaking.current !== locale) {
            builtSpeaking.current = locale;
            void rebuild(openKey, false);
        }
    }, [locale, openKey, rebuild]);

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
            onSave: () => { void saveRef.current(); },
            onLeave: () => { leaveRef.current(); },
            ariaLabel: editorLabel,
        });
        serviceRef.current = service;
        service.mount(node, library.readDraft() ?? opening(library, openOn)?.files ?? starter);
        void rebuild(opening(library, openOn)?.key ?? null, false);
    // Mounted once. Rebuilding on every change of `rebuild` would tear the
    // editor down and put it back mid-keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Held in a ref because the teardown runs once, long after the render that
    // knew whether anything had been saved.
    const openKeyOnTeardown = useRef<string | null>(null);
    const openKeyRef = useRef<string | null>(null);
    const nameRef = useRef(untitled);
    useEffect(() => { openKeyOnTeardown.current = openKey; openKeyRef.current = openKey; }, [openKey]);
    useEffect(() => { nameRef.current = name; }, [name]);

    useEffect(() => () => {
        serviceRef.current?.unmount();
        serviceRef.current = null;
        // A reading never saved was a preview of what the reader was typing.
        // Left behind, opening the editor out of curiosity and closing it put a
        // layer on the chart that outlived every trace of what drew it.
        if (openKeyOnTeardown.current === null) {
            forgetAddon(liveId(null));
            discardDraft(kernel);
        }
    }, [kernel]);

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
        // Read before the await, so a keystroke while the compiler is working
        // cannot file a source that does not match the compiled beside it.
        const files = service.readFiles();
        const { compiled, faults } = await service.compile();
        if (faults.length > 0) {
            // Refused rather than filed against the last build that worked: the
            // pair would then disagree, and the next reload would draw
            // arithmetic that is nowhere in the file the editor shows.
            setStatus({ kind: 'faulted', faults });
            return;
        }
        compiledRef.current = compiled;
        // The name is taken from the reading itself unless the reader has typed
        // one, and taken here rather than from state: pressing save before the
        // first compile had landed filed the reading under `Untitled`.
        const built = buildAddon(compiled);
        const called = isNamedByHand || built.kind !== 'ready' ? name : built.indicator.label;
        const key = openKey ?? library.mintKey(called);
        if (library.save({ key, name: called, files, compiled }) === null) {
            setStatus({ kind: 'broken', message: shelfRefusedMessage });
            return;
        }
        if (openKey === null && built.kind === 'ready') {
            adoptDraft(kernel, key, built.indicator);
        }
        setName(called);
        setOpenKey(key);
        setSaved(library.list());
        setIsUnsaved(false);
        // Filed, so it is no longer a draft: reopening should give the reader
        // what is on the shelf rather than a copy of it.
        library.rememberDraft(null);
    }, [isNamedByHand, kernel, library, name, openKey, shelfRefusedMessage]);

    const load = useCallback((
        files: ReadingFiles,
        key: string | null,
        called: string | null,
        // Putting work back is not replacing it: recorded, undoing would offer
        // to undo itself and the offer would never go away.
        isUndo = false,
    ): void => {
        const service = serviceRef.current;
        if (service === null) {
            return;
        }
        // What is being replaced is offered back. Starting a new one, opening
        // another and importing a file all overwrite the buffer, and none of
        // them was a decision to throw away what was in it.
        const leaving = service.readFiles();
        if (!isUndo && !isBlank(leaving) && !isSameWork(leaving, files)) {
            setLastDiscarded({ name: nameRef.current, files: leaving, key: openKeyRef.current, wasDeleted: false });
        }
        service.replaceFiles(files);
        library.rememberDraft(files);
        setOpenKey(key);
        setIsNamedByHand(called !== null);
        setName(called ?? untitled);
        setIsUnsaved(false);
        // The key is handed over rather than read back: this runs before the
        // state settles, and publishing under the key being left behind put the
        // reading back on the chart the moment it was deleted.
        void rebuild(key, false);
    }, [library, rebuild, untitled]);

    const open = useCallback((key: string): void => {
        const found = library.find(key);
        if (found !== null) {
            load(found.files, found.key, found.name);
        }
    }, [library, load]);

    const startAnew = useCallback((): void => { load(starter, null, null); }, [load, starter]);

    const remove = useCallback((): void => {
        // Deleted at once and offered back, which is how this chart treats every
        // other removal: a confirmation asks about work the reader has not lost
        // yet, and an undo answers about work they have.
        const held = serviceRef.current?.readFiles() ?? {};
        if (openKey !== null) {
            library.remove(openKey);
            forgetAddon(liveId(openKey));
            kernel.chart.updateIndicators(
                (current) => current.filter((entry) => entry.indicatorId !== liveId(openKey)),
            );
            setSaved(library.list());
        }
        setLastDiscarded({ name, files: held, key: openKey, wasDeleted: true });
        load(starter, null, null);
    }, [kernel, library, load, name, openKey, starter]);

    const undoDiscard = useCallback((): void => {
        if (lastDiscarded === null) {
            return;
        }
        const { key, name: called, files, wasDeleted } = lastDiscarded;
        if (wasDeleted && key !== null) {
            library.save({ key, name: called, files, compiled: compiledRef.current });
            setSaved(library.list());
        }
        setLastDiscarded(null);
        load(files, key, called, true);
    }, [lastDiscarded, library, load]);

    // Long enough to notice the mistake, short enough not to sit there.
    useEffect(() => {
        if (lastDiscarded === null) {
            return;
        }
        const timer = setTimeout(() => { setLastDiscarded(null); }, REMOVAL_GRACE_MS);
        return () => { clearTimeout(timer); };
    }, [lastDiscarded]);

    const exportFile = useCallback((): void => {
        const files = serviceRef.current?.readFiles() ?? {};
        const stem = name.replace(/[^\w.-]+/g, '-') || 'reading';
        const only = Object.keys(files);
        // One file leaves as itself, so a reading anybody can read stays a
        // script rather than becoming an envelope with a script inside it.
        if (only.length === 1) {
            downloadAsFile(`${stem}.ts`, files[only[0]!] ?? '');
            return;
        }
        downloadAsFile(`${stem}${BUNDLE_SUFFIX}`, JSON.stringify({ fathom: 1, name, files }, null, 4));
    }, [name]);

    const importFile = useCallback(async (file: File): Promise<void> => {
        // Capped and checked before it reaches the editor. The picker's accept
        // list is a hint a reader can step past, and a file chosen by mistake
        // lands on top of whatever they had not saved.
        if (file.size > LARGEST_IMPORT_BYTES) {
            setStatus({ kind: 'broken', message: importTooLargeMessage });
            return;
        }
        const text = await file.text();
        if (!isText(text)) {
            setStatus({ kind: 'broken', message: importNotTextMessage });
            return;
        }
        const bundle = readBundle(text);
        if (file.name.endsWith('.json') && bundle === null) {
            setStatus({ kind: 'broken', message: importNotBundleMessage });
            return;
        }
        if (bundle === null) {
            load({ [ENTRY_FILE]: text }, null, file.name.replace(/\.[jt]sx?$/, ''));
            return;
        }
        load(bundle.files, null, bundle.name ?? file.name.replace(BUNDLE_SUFFIX, ''));
    }, [importNotBundleMessage, importNotTextMessage, importTooLargeMessage, load]);

    const openBroughtIn = useCallback((brought: ReadingFiles, called: string): void => {
        load(brought, null, called);
    }, [load]);

    // Mirrored into state because the files live in the editor, which is not
    // React's, and a list nothing re-renders is a list that never changes.
    const [files, setFiles] = useState<readonly string[]>([ENTRY_FILE]);
    const [shownFile, setShownFile] = useState(ENTRY_FILE);
    const followFiles = useCallback((): void => {
        const service = serviceRef.current;
        if (service !== null) {
            setFiles(service.listFiles());
            setShownFile(service.shownFile());
        }
    }, []);
    useEffect(followFiles, [followFiles, status]);

    const showFile = useCallback((path: string): void => {
        serviceRef.current?.showFile(path);
        followFiles();
    }, [followFiles]);

    const addFile = useCallback((path: string): string | null => {
        const refusal = tryFileChange(() => { serviceRef.current?.addFile(path); });
        followFiles();
        return refusal;
    }, [followFiles]);

    const renameFile = useCallback((from: string, to: string): string | null => {
        const refusal = tryFileChange(() => { serviceRef.current?.renameFile(from, to); });
        followFiles();
        return refusal;
    }, [followFiles]);

    const removeFile = useCallback((path: string): void => {
        serviceRef.current?.removeFile(path);
        followFiles();
    }, [followFiles]);

    useEffect(() => { saveRef.current = save; });
    useEffect(() => { leaveRef.current = onLeave; });

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
        lastDiscarded,
        undoDiscard,
        exportFile,
        importFile,
        openBroughtIn,
        files,
        shownFile,
        showFile,
        addFile,
        renameFile,
        removeFile,
    };
}

/** What a reading with more than one file leaves as. */
const BUNDLE_SUFFIX = '.fathom.json';

/** Whether nothing has been written in any of a reading's files. */
function isBlank(files: ReadingFiles): boolean {
    return Object.values(files).every((source) => source.trim() === '');
}

/** Whether two readings hold the same files with the same text in them. */
function isSameWork(one: ReadingFiles, other: ReadingFiles): boolean {
    const paths = Object.keys(one);
    return paths.length === Object.keys(other).length
        && paths.every((path) => one[path] === other[path]);
}

/**
 * A reading out of an exported bundle.
 *
 * @param text - What was in the file.
 * @returns The reading, or null where the file is not one of ours.
 */
function readBundle(text: string): { readonly name?: string; readonly files: ReadingFiles } | null {
    try {
        const parsed = JSON.parse(text) as { fathom?: unknown; name?: unknown; files?: unknown };
        const files = parsed.files;
        if (parsed.fathom !== 1 || typeof files !== 'object' || files === null) {
            return null;
        }
        const held = Object.entries(files).filter(([, source]) => typeof source === 'string');
        if (held.length === 0) {
            return null;
        }
        return {
            ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
            files: Object.fromEntries(held),
        };
    } catch {
        return null;
    }
}

/** Runs a change to the reading's files, answering with what it refused over. */
function tryFileChange(change: () => void): string | null {
    try {
        change();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/**
 * Takes the never-saved preview off the chart.
 *
 * @param kernel - The services the chart runs on.
 */
function discardDraft(kernel: EditorKernel): void {
    kernel.chart.updateIndicators(
        (current) => current.filter((entry) => entry.indicatorId !== liveId(null)),
    );
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
function adoptDraft(kernel: EditorKernel, key: string, indicator: Indicator): void {
    const from = liveId(null);
    const to = liveId(key);
    registerAddon(key, indicator);
    forgetAddon(from);
    kernel.chart.updateIndicators((current) => current.map((entry) => (
        entry.indicatorId === from ? { ...entry, indicatorId: to } : entry
    )));
}

/** As much of the kernel as the editing needs. */
interface EditorKernel {
    readonly chart: {
        readonly updateIndicators: (
            revise: (current: readonly AddedIndicator[]) => readonly AddedIndicator[],
        ) => void;
    };
}

/** The id a reading is registered under while it is on the chart. */
function liveId(key: string | null): string {
    return key === null ? UNSAVED_ADDON_ID : `${ADDON_ID_PREFIX}${key}`;
}

/**
 * The reading to open on, where one was asked for.
 *
 * Nothing when none was named. Falling back to the last one saved meant a
 * button that says *write a reading* opened a reading the reader already had,
 * with its key bound — and the next save quietly replaced it.
 *
 * @param library - Where the readings are kept.
 * @param wanted - A key the reader picked, where they picked one.
 * @returns What to show, or null for an empty shelf.
 */
function opening(
    library: { find: (key: string) => SavedReading | null },
    wanted: string | undefined,
): SavedReading | null {
    return wanted === undefined ? null : library.find(wanted);
}

/**
 * Whether a file the reader chose is something they could have written.
 *
 * By the control characters no source carries. A picture dropped in by mistake
 * is otherwise pasted into the editor as several megabytes of mojibake, over
 * whatever had not been saved.
 *
 * @param text - The head of the file is enough to tell.
 * @returns True where it reads as text.
 */
function isText(text: string): boolean {
    for (const character of text.slice(0, 4_096)) {
        const code = character.codePointAt(0) ?? 0;
        const isPrintable = code >= 32 || code === 9 || code === 10 || code === 13;
        if (!isPrintable) {
            return false;
        }
    }

    return true;
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
    // Released on the next turn rather than on the next line: revoked at once,
    // some browsers have not started reading it yet and the save quietly does
    // not happen, which a reader only discovers when they need the backup.
    setTimeout(() => { URL.revokeObjectURL(url); }, 0);
}
