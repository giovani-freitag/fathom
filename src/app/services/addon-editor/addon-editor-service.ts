import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import typescriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { ADDON_SURFACE_TYPES } from '../../addons/addon-surface.generated.ts';

/** Where the reader's file lives, as far as the language service is concerned. */
const ADDON_URI = 'file:///addon.ts';

/** Where the surface lives, so a bare import of it resolves. */
const SURFACE_URI = 'file:///node_modules/@types/fathom/index.d.ts';

export interface AddonEditorServiceConfig {
    /** Runs on every edit, after the pause. */
    readonly onChange: (source: string) => void;
    /** Which of the chart's two palettes to open in. */
    readonly theme?: 'dark' | 'light';
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
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            renderLineHighlight: 'gutter',
            overviewRulerLanes: 0,
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
            padding: { top: 12, bottom: 12 },
            tabSize: 4,
        });
        this.subscription = this.model.onDidChangeContent(this.handleModelChange);
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
        this.editor?.updateOptions({ theme: `fathom-${theme}` });
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
 * The palette, taken from the chart's own tokens rather than invented.
 *
 * Two, because the chart has two: an editor that stayed dark inside a light
 * page is the one panel that did not hear the reader change their mind.
 */
const PALETTES = {
    dark: {
        base: 'vs-dark' as const,
        ground: '#080d14',
        highlight: '#111a26',
        ink: '#dce7f1',
        muted: '#62778b',
        keyword: '#b48ef7',
        text: '#2bd4a8',
        figure: '#ffb454',
        type: '#57c7ff',
    },
    light: {
        base: 'vs' as const,
        ground: '#ffffff',
        highlight: '#f2f6fa',
        ink: '#0b1620',
        muted: '#64788c',
        keyword: '#7b3fd4',
        text: '#0a9683',
        figure: '#a35c00',
        type: '#0b6ea8',
    },
} as const;

/** What the editor is told to look like, one theme per palette. */
function defineThemes(): void {
    for (const [name, palette] of Object.entries(PALETTES)) {
        monaco.editor.defineTheme(`fathom-${name}`, {
            base: palette.base,
            inherit: true,
            rules: [
                { token: 'comment', foreground: palette.muted.slice(1), fontStyle: 'italic' },
                { token: 'keyword', foreground: palette.keyword.slice(1) },
                { token: 'string', foreground: palette.text.slice(1) },
                { token: 'number', foreground: palette.figure.slice(1) },
                { token: 'type', foreground: palette.type.slice(1) },
                { token: 'type.identifier', foreground: palette.type.slice(1) },
            ],
            colors: {
                'editor.background': palette.ground,
                'editorGutter.background': palette.ground,
                'editor.lineHighlightBackground': palette.highlight,
                'editorLineNumber.foreground': palette.muted,
                'editorLineNumber.activeForeground': palette.ink,
                'editorIndentGuide.background1': palette.highlight,
                'editorWidget.background': palette.ground,
                'editorSuggestWidget.background': palette.ground,
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
