import * as monaco from 'monaco-editor';
import { readPaletteFor } from '../../painting/render-palette.ts';
import type { ResolvedTheme } from '../../core/theme.ts';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import typescriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { ADDON_SURFACE_TYPES } from '../../addons/addon-surface.generated.ts';

/** The chart's monospace, as the stylesheet declares it. */
const MONOSPACE = "'Azeret Mono', ui-monospace, 'SF Mono', monospace";

/** Where the reader's file lives, as far as the language service is concerned. */
const ADDON_URI = 'file:///addon.ts';

/** Where the surface lives, so a bare import of it resolves. */
const SURFACE_URI = 'file:///node_modules/@types/fathom/index.d.ts';

export interface AddonEditorServiceConfig {
    /** Runs on every edit, after the pause. */
    readonly onChange: (source: string) => void;
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

/** A fault the language service found, in the reader's own coordinates. */
export interface SourceFault {
    readonly message: string;
    readonly line: number;
    readonly column: number;
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
    private model: monaco.editor.ITextModel | null = null;
    private subscription: monaco.IDisposable | null = null;
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
    mount(host: HTMLElement, source: string): void {
        if (this.editor !== null) {
            throw new Error('The addon editor is already mounted.');
        }
        configureLanguage();

        const uri = monaco.Uri.parse(ADDON_URI);
        this.model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(source, 'typescript', uri);
        this.model.setValue(source);
        this.editor = monaco.editor.create(host, {
            model: this.model,
            theme: `fathom-${this.config.theme ?? 'dark'}`,
            automaticLayout: true,
            minimap: { enabled: false },
            // Wrapped rather than scrolled sideways: the panel is narrow beside
            // the chart it is about, and a line that runs off the edge is read
            // by dragging a bar back and forth instead of by reading.
            wordWrap: 'on',
            wrappingIndent: 'indent',
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
        this.subscription = this.model.onDidChangeContent(this.handleModelChange);
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

    /** Releases the editor, its model and everything watching them. */
    unmount(): void {
        this.clearTimer();
        this.subscription?.dispose();
        this.editor?.dispose();
        this.model?.dispose();
        this.subscription = null;
        this.editor = null;
        this.model = null;
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

    /** What the reader has typed. */
    readSource(): string {
        return this.model?.getValue() ?? '';
    }

    /**
     * Puts a different script in the editor, as opening one does.
     *
     * @param source - What to show instead.
     */
    replaceSource(source: string): void {
        this.model?.setValue(source);
    }

    /**
     * Compiles what is in the editor.
     *
     * @returns The JavaScript, or the faults that stopped it being produced.
     */
    async compile(): Promise<{ readonly compiled: string; readonly faults: readonly SourceFault[] }> {
        const model = this.model;
        if (model === null) {
            return { compiled: '', faults: [] };
        }

        const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
        const worker = await getWorker(model.uri);
        const faults = await this.readFaults(worker, model);
        if (faults.length > 0) {
            return { compiled: '', faults };
        }

        const emitted = await worker.getEmitOutput(model.uri.toString());
        return { compiled: emitted.outputFiles[0]?.text ?? '', faults: [] };
    }

    /**
     * Marks a fault the compiler could not have seen, such as one thrown at run time.
     *
     * @param fault - What went wrong and where, or null to clear.
     */
    showRuntimeFault(fault: { readonly message: string; readonly line?: number } | null): void {
        const model = this.model;
        if (model === null) {
            return;
        }
        const line = Math.min(fault?.line ?? 1, model.getLineCount());
        monaco.editor.setModelMarkers(model, 'fathom-runtime', fault === null ? [] : [{
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
            };
        });
    }

    private handleModelChange(): void {
        this.clearTimer();
        this.settleTimer = setTimeout(this.handleSettle, this.config.settleMs ?? 400);
    }

    private handleSettle(): void {
        this.settleTimer = null;
        this.config.onChange(this.readSource());
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
        moduleResolution: typescript.ModuleResolutionKind.NodeJs,
        strict: true,
        noEmitOnError: false,
        allowNonTsExtensions: true,
        lib: ['es2020', 'dom'],
    });
    typescript.typescriptDefaults.addExtraLib(ADDON_SURFACE_TYPES, SURFACE_URI);
    defineThemes();
}
