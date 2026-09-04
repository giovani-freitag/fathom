import * as monaco from 'monaco-editor';
import { readPaletteFor } from '../../painting/render-palette.ts';
import type { ResolvedTheme } from '../../core/theme.ts';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import typescriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { ADDON_SURFACE_TYPES } from '../../addons/addon-surface.generated.ts';
import { delay } from '../../../shared/core/timers.ts';
import { ENTRY_FILE, folderOf, isLegalPath, type ReadingFiles } from '../../../shared/core/reading-files.ts';

/** The chart's monospace, as the stylesheet declares it. */
const MONOSPACE = "'Azeret Mono', ui-monospace, 'SF Mono', monospace";

/**
 * `ModuleResolutionKind.Bundler`, which Monaco's own enum predates.
 *
 * Named by its number because the editor ships the two kinds TypeScript had at
 * the time; the compiler behind it knows the rest.
 */
const BUNDLER_RESOLUTION = 100 as monaco.languages.typescript.ModuleResolutionKind;

/** Where a reading's files live, as far as the language service is concerned. */
const READING_ROOT = 'file:///reading/';

/** Where the surface lives, so a bare import of it resolves. */
const SURFACE_URI = 'file:///node_modules/@types/fathom/index.d.ts';

/** How long to keep asking for the language service before giving up on it. */
const REGISTRATION_TRIES = 40;
const REGISTRATION_WAIT_MS = 50;

export interface AddonEditorServiceConfig {
    /** Runs on every edit, after the pause. */
    readonly onChange: (files: ReadingFiles) => void;
    /** Which of the chart's two palettes to open in. */
    readonly theme?: 'dark' | 'light';
    /** Runs on the chord every text box in the world answers to. */
    readonly onSave?: () => void;
    /** Runs when the reader asks to leave the editor by keyboard. */
    readonly onLeave?: () => void;
    /** What a screen reader calls the editor. */
    readonly ariaLabel?: string;
    /** How long a pause counts as having stopped typing. */
    readonly settleMs?: number;
}

/** What one pass of the compiler produced, all read at the same instant. */
export interface CompileResult {
    /** The source it worked from, by path. */
    readonly files: ReadingFiles;
    /** The JavaScript it emitted, by the same paths. Empty where it refused. */
    readonly compiled: ReadingFiles;
    readonly faults: readonly SourceFault[];
}

/** A fault the language service found, in the reader's own coordinates. */
export interface SourceFault {
    readonly message: string;
    readonly line: number;
    readonly column: number;
    /** Which of the reading's files it is in. */
    readonly file: string;
}

/**
 * The in-page editor, and the compiler behind it.
 *
 * A service because it owns resources with a life of their own — a model, an
 * editor, listeners and the language worker — none of which a React render may
 * create or destroy.
 */
export class AddonEditorService {
    private readonly config: AddonEditorServiceConfig;
    private editor: monaco.editor.IStandaloneCodeEditor | null = null;
    private readonly models = new Map<string, monaco.editor.ITextModel>();
    private readonly watches = new Map<string, monaco.IDisposable>();
    private shown = ENTRY_FILE;
    private settleTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(config: AddonEditorServiceConfig) {
        this.config = config;
        this.handleModelChange = this.handleModelChange.bind(this);
        this.handleSettle = this.handleSettle.bind(this);
    }

    /**
     * Mounts the editor into an element and starts watching it.
     *
     * @param host - Where to put it.
     * @param source - What to open with.
     * @throws Error when called twice without a teardown between.
     */
    mount(host: HTMLElement, files: ReadingFiles): void {
        if (this.editor !== null) {
            throw new Error('The addon editor is already mounted.');
        }
        configureLanguage();
        this.replaceFiles(files);
        this.editor = monaco.editor.create(host, {
            model: this.models.get(this.shown) ?? null,
            theme: `fathom-${this.config.theme ?? 'dark'}`,
            automaticLayout: true,
            minimap: { enabled: false },
            // Wrapped rather than scrolled sideways: the panel is narrow beside
            // the chart it is about, and a line that runs off the edge is read
            // by dragging a bar back and forth instead of by reading.
            wordWrap: 'on',
            // Aligned with the line it came from rather than a level in: a
            // panel this narrow wraps a chained call several times, and each
            // extra level walks the rest of it further off the right edge.
            wrappingIndent: 'same',
            fontSize: 12,
            // The chart's own monospace. Left unset, Monaco paints two thirds
            // of this panel in a typeface that appears nowhere else here.
            fontFamily: MONOSPACE,
            fontLigatures: false,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            renderLineHighlight: 'gutter',
            overviewRulerLanes: 0,
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
            padding: { top: 12, bottom: 12 },
            tabSize: 4,
            ...(this.config.ariaLabel === undefined ? {} : { ariaLabel: this.config.ariaLabel }),
        });
        this.bindChords();
    }

    /**
     * Answers the two chords a reader arrives already knowing.
     *
     * Save, because a code editor that answers Ctrl+S with the browser's
     * save-page dialog is answering the most ingrained reflex there is with a
     * file picker. And escape, because Monaco eats Tab: without a way out by
     * keyboard, everything below the editor is unreachable — including the
     * offer to undo a deletion.
     */
    private bindChords(): void {
        const editor = this.editor;
        if (editor === null) {
            return;
        }
        editor.addAction({
            id: 'fathom.save',
            label: 'Save this reading',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
            run: () => { this.config.onSave?.(); },
        });
        editor.addAction({
            id: 'fathom.leave',
            label: 'Leave the editor',
            keybindings: [monaco.KeyCode.Escape],
            run: () => { this.config.onLeave?.(); },
        });
    }

    /** Releases the editor, its models and everything watching them. */
    unmount(): void {
        this.clearTimer();
        this.editor?.dispose();
        this.editor = null;
        this.forgetAll();
    }

    /**
     * Puts the editor in one of the chart's two palettes.
     *
     * @param theme - Which one is in force.
     */
    applyTheme(theme: 'dark' | 'light'): void {
        // Set on the editor rather than on this instance: a theme in Monaco is
        // global, and `updateOptions` quietly accepts one and changes nothing.
        if (this.editor !== null) {
            monaco.editor.setTheme(`fathom-${theme}`);
        }
    }

    /** What the reader has typed, by path. */
    readFiles(): ReadingFiles {
        return Object.fromEntries([...this.models].map(([path, model]) => [path, model.getValue()]));
    }

    /** The paths in the reading, in the order they are shown. */
    listFiles(): readonly string[] {
        // The entry first, wherever its name would sort: it is where the
        // reading starts, and a list of files is read from the start.
        const rest = [...this.models.keys()].filter((path) => path !== ENTRY_FILE);
        return [ENTRY_FILE, ...rest.sort(byPath)];
    }

    /** Which file the editor is showing. */
    shownFile(): string {
        return this.shown;
    }

    /**
     * Puts a different reading in the editor, as opening one does.
     *
     * @param files - What to show instead, by path.
     */
    replaceFiles(files: ReadingFiles): void {
        const wanted = Object.keys(files).length === 0 ? { [ENTRY_FILE]: '' } : files;

        // Kept and rewritten where a path survives, rather than thrown away and
        // built again at the same address. A model taken down and put back
        // under the URI it had is a model the language service goes on holding
        // the old text of — so a reading opened whole compiled as the one it
        // replaced, and only a keystroke put it right.
        for (const path of [...this.models.keys()]) {
            if (wanted[path] === undefined) {
                this.forget(path);
                this.models.delete(path);
            }
        }
        for (const [path, source] of Object.entries(wanted)) {
            const held = this.models.get(path);
            if (held === undefined) {
                this.models.set(path, this.buildModel(path, source));
            } else {
                held.setValue(source);
            }
        }
        this.showFile(wanted[this.shown] === undefined ? ENTRY_FILE : this.shown);
    }

    /**
     * Shows one of the reading's files.
     *
     * @param path - Which file, ignored where the reading has no such file.
     */
    showFile(path: string): void {
        const model = this.models.get(path);
        if (model === undefined) {
            return;
        }
        this.shown = path;
        this.editor?.setModel(model);
    }

    /**
     * Adds an empty file to the reading and shows it.
     *
     * @param path - Where it sits within the reading.
     * @throws Error when the path is not one a reading may hold, or is taken.
     */
    addFile(path: string): void {
        if (!isLegalPath(path)) {
            throw new Error(`“${path}” is not a name a file can have. Try something like helpers.ts.`);
        }
        if (this.models.has(path)) {
            throw new Error(`This reading already has a ${path}.`);
        }
        this.models.set(path, this.buildModel(path, ''));
        this.showFile(path);
        this.handleModelChange();
    }

    /**
     * Takes a file out of the reading.
     *
     * @param path - Which file. The entry cannot be removed.
     */
    removeFile(path: string): void {
        if (path === ENTRY_FILE || !this.models.has(path)) {
            return;
        }
        this.forget(path);
        this.models.delete(path);
        if (this.shown === path) {
            this.showFile(ENTRY_FILE);
        }
        this.handleModelChange();
    }

    /**
     * Moves a file within the reading, keeping what is in it.
     *
     * @param from - The path it has.
     * @param to - The path it should have.
     * @throws Error when the new path is not one a reading may hold, or is taken.
     */
    renameFile(from: string, to: string): void {
        const model = this.models.get(from);
        if (from === ENTRY_FILE || model === undefined || from === to) {
            return;
        }
        if (!isLegalPath(to)) {
            throw new Error(`“${to}” is not a name a file can have. Try something like helpers.ts.`);
        }
        if (this.models.has(to)) {
            throw new Error(`This reading already has a ${to}.`);
        }
        // Rebuilt rather than moved: a model's URI is what the language service
        // resolves an import against, and Monaco does not let one be changed.
        const held = model.getValue();
        this.forget(from);
        this.models.delete(from);
        this.models.set(to, this.buildModel(to, held));
        this.showFile(this.shown === from ? to : this.shown);
        this.handleModelChange();
    }

    private buildModel(path: string, source: string): monaco.editor.ITextModel {
        const uri = monaco.Uri.parse(`${READING_ROOT}${path}`);
        const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(source, 'typescript', uri);
        model.setValue(source);
        this.watches.set(path, model.onDidChangeContent(this.handleModelChange));
        return model;
    }

    private forget(path: string): void {
        this.watches.get(path)?.dispose();
        this.watches.delete(path);
        this.models.get(path)?.dispose();
    }

    private forgetAll(): void {
        for (const path of [...this.models.keys()]) {
            this.forget(path);
        }
        this.models.clear();
    }

    /**
     * Compiles what is in the editor.
     *
     * The source comes back beside the JavaScript, read at the same instant:
     * the compiler works over a round trip, and anything typed meanwhile is in
     * one and not the other. Filed as a pair, they would disagree, and the next
     * reload would draw arithmetic that is nowhere in the file being shown.
     *
     * @returns The source, the JavaScript, or the faults that stopped it.
     */
    async compile(): Promise<CompileResult> {
        const entry = this.models.get(ENTRY_FILE);
        if (entry === undefined) {
            return { files: {}, compiled: {}, faults: [] };
        }

        // Every model, not just the entry: what `getWorker` guarantees is that
        // the models it was handed have reached the worker. Named alone, the
        // entry was in step and the rest were whatever the worker last saw — so
        // a reading opened whole compiled as the one it replaced.
        const worker = await this.reachWorker([...this.models.values()].map((model) => model.uri));
        const found = await Promise.all(
            [...this.models].map(async ([path, model]) => ({
                path,
                source: model.getValue(),
                faults: await this.readFaults(worker, model, path),
                emitted: await worker.getEmitOutput(model.uri.toString()),
            })),
        );

        const files = Object.fromEntries(found.map((one) => [one.path, one.source]));
        const faults = found.flatMap((one) => one.faults);
        if (faults.length > 0) {
            return { files, compiled: {}, faults };
        }
        return {
            files,
            compiled: Object.fromEntries(
                found.map((one) => [one.path, one.emitted.outputFiles[0]?.text ?? '']),
            ),
            faults: [],
        };
    }

    /**
     * The TypeScript worker for a reading's files.
     *
     * @param uris - Every model the compile has to see, not only the entry.
     * @returns The worker, once Monaco has registered its language service.
     * @throws Whatever Monaco last refused with, once the tries run out.
     */
    private async reachWorker(
        uris: readonly monaco.Uri[],
    ): Promise<monaco.languages.typescript.TypeScriptWorker> {
        // Monaco registers the service turns after the model that triggered it,
        // and refuses rather than waiting until it has — which is every first
        // compile of a freshly opened editor.
        for (let attempt = 1; attempt < REGISTRATION_TRIES; attempt += 1) {
            try {
                const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
                return await getWorker(...uris);
            } catch {
                await delay(REGISTRATION_WAIT_MS);
            }
        }

        const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
        return getWorker(...uris);
    }

    /**
     * Marks a fault the compiler could not have seen, such as one thrown at run time.
     *
     * @param fault - What went wrong and where, or null to clear.
     */
    showRuntimeFault(
        fault: { readonly message: string; readonly line?: number; readonly file?: string } | null,
    ): void {
        for (const held of this.models.values()) {
            monaco.editor.setModelMarkers(held, 'fathom-runtime', []);
        }
        const model = this.models.get(fault?.file ?? ENTRY_FILE);
        if (fault === null || model === undefined) {
            return;
        }
        const line = Math.min(fault.line ?? 1, model.getLineCount());
        monaco.editor.setModelMarkers(model, 'fathom-runtime', [{
            severity: monaco.MarkerSeverity.Error,
            message: fault.message,
            startLineNumber: line,
            endLineNumber: line,
            startColumn: 1,
            endColumn: model.getLineMaxColumn(line),
        }]);
    }

    private async readFaults(
        worker: monaco.languages.typescript.TypeScriptWorker,
        model: monaco.editor.ITextModel,
        path: string,
    ): Promise<readonly SourceFault[]> {
        const uri = model.uri.toString();
        const [syntactic, semantic] = await Promise.all([
            worker.getSyntacticDiagnostics(uri),
            worker.getSemanticDiagnostics(uri),
        ]);

        return [...syntactic, ...semantic].map((one) => {
            const at = model.getPositionAt(one.start ?? 0);
            return {
                message: typeof one.messageText === 'string' ? one.messageText : one.messageText.messageText,
                line: at.lineNumber,
                column: at.column,
                file: path,
            };
        });
    }

    private handleModelChange(): void {
        this.clearTimer();
        this.settleTimer = setTimeout(this.handleSettle, this.config.settleMs ?? 400);
    }

    private handleSettle(): void {
        this.settleTimer = null;
        this.config.onChange(this.readFiles());
    }

    private clearTimer(): void {
        if (this.settleTimer !== null) {
            clearTimeout(this.settleTimer);
            this.settleTimer = null;
        }
    }
}

let isLanguageConfigured = false;

/**
 * What the editor is painted with, taken from what the chart is painted with.
 *
 * Read off the same table rather than copied: a third hand-written palette is a
 * third thing to keep in step, and the two that already exist are the ones the
 * reader is looking at either side of this panel.
 */
function buildPalette(theme: ResolvedTheme) {
    const chart = readPaletteFor(theme);
    return {
        base: theme === 'dark' ? ('vs-dark' as const) : ('vs' as const),
        ground: theme === 'dark' ? '#080d14' : '#ffffff',
        highlight: theme === 'dark' ? '#111a26' : '#f2f6fa',
        hairline: theme === 'dark' ? '#1b2836' : '#d2dbe5',
        ink: chart.inkPrimary,
        // The axis labels' step, not the muted one. Comments are a third of the
        // starter and the muted step reads at 4.2 to 1, which this chart has
        // already refused once for the same reason on its own axes.
        muted: chart.axisLabel,
        keyword: chart.violet,
        // The accent rather than the buy colour: a string is the most common
        // token in the starter, and the buy colour reads at 3.7 to 1 on white.
        text: chart.phosphor,
        figure: chart.amber,
        type: chart.cyan,
        accent: chart.phosphor,
        fault: chart.ask,
    };
}

/** What the editor is told to look like, one theme per palette. */
function defineThemes(): void {
    for (const theme of ['dark', 'light'] as const) {
        const palette = buildPalette(theme);
        const bare = (colour: string): string => colour.replace('#', '');
        monaco.editor.defineTheme(`fathom-${theme}`, {
            base: palette.base,
            inherit: true,
            rules: [
                { token: '', foreground: bare(palette.ink) },
                { token: 'comment', foreground: bare(palette.muted), fontStyle: 'italic' },
                { token: 'keyword', foreground: bare(palette.keyword) },
                { token: 'string', foreground: bare(palette.text) },
                { token: 'number', foreground: bare(palette.figure) },
                { token: 'type', foreground: bare(palette.type) },
                { token: 'type.identifier', foreground: bare(palette.type) },
            ],
            colors: {
                // Named in full rather than inherited: everything left out here
                // is painted in Visual Studio's palette, and this chart has no
                // blue accent to be selected in.
                'editor.background': palette.ground,
                'editor.foreground': palette.ink,
                'editorGutter.background': palette.ground,
                'editor.lineHighlightBackground': palette.highlight,
                'editor.selectionBackground': `${palette.accent}33`,
                'editor.inactiveSelectionBackground': `${palette.accent}1f`,
                'editorCursor.foreground': palette.accent,
                'editorLineNumber.foreground': palette.muted,
                'editorLineNumber.activeForeground': palette.ink,
                'editorIndentGuide.background1': palette.highlight,
                'editorError.foreground': palette.fault,
                'editorWarning.foreground': palette.figure,
                'editorWidget.background': palette.ground,
                'editorWidget.border': palette.hairline,
                'editorSuggestWidget.background': palette.ground,
                'editorSuggestWidget.border': palette.hairline,
                'editorSuggestWidget.selectedBackground': palette.highlight,
                'editorHoverWidget.background': palette.ground,
                'editorHoverWidget.border': palette.hairline,
                'list.hoverBackground': palette.highlight,
            },
        });
    }
}

/**
 * Points the editor at its own workers, which the bundler names for us.
 *
 * The language service runs off the main thread, which is also what keeps a
 * large file from making the chart stutter while somebody types into it.
 */
function configureWorkers(): void {
    self.MonacoEnvironment = {
        getWorker(_workerId: string, label: string): Worker {
            return label === 'typescript' || label === 'javascript'
                ? new typescriptWorker()
                : new editorWorker();
        },
    };
}


/**
 * Teaches the language service what an addon may reach, once per page.
 *
 * CommonJS on purpose: what comes out is run by handing it a `require`, so the
 * page never has to resolve a bare specifier at run time.
 */
/** Folders before loose files, then by name, so a list reads like a tree. */
function byPath(one: string, other: string): number {
    const depth = folderOf(other).split('/').length - folderOf(one).split('/').length;
    return folderOf(one) === folderOf(other) ? one.localeCompare(other) : depth || one.localeCompare(other);
}

function configureLanguage(): void {
    if (isLanguageConfigured) {
        return;
    }
    isLanguageConfigured = true;
    configureWorkers();

    const typescript = monaco.languages.typescript;
    typescript.typescriptDefaults.setCompilerOptions({
        target: typescript.ScriptTarget.ES2020,
        module: typescript.ModuleKind.CommonJS,
        // Bundler, by its number: Monaco's enum stops at the two TypeScript
        // had when it was written. It is the mode where `./helpers.js` resolves
        // to `helpers.ts`, which is how TypeScript has an import written and
        // what the linker behind this already does.
        moduleResolution: BUNDLER_RESOLUTION,
        strict: true,
        noEmitOnError: false,
        allowNonTsExtensions: true,
        lib: ['es2020', 'dom'],
    });
    typescript.typescriptDefaults.addExtraLib(ADDON_SURFACE_TYPES, SURFACE_URI);
    defineThemes();
}
