import { vi } from 'vitest';

/**
 * A Monaco with models and nothing else.
 *
 * Enough of it to exercise what the editor service does to its models —
 * building them, rewriting them, taking them away — without a browser, a
 * worker, or the megabyte of editor behind them.
 */

/** One model, tracking what was done to it so a test can say what happened. */
export class FakeModel {
    readonly uri: { readonly path: string; toString: () => string };
    /** How many times its whole text has been replaced. */
    setValueCount = 0;
    isDisposed = false;

    private text: string;

    constructor(text: string, path: string) {
        this.text = text;
        this.uri = { path, toString: () => path };
    }

    getValue(): string {
        return this.text;
    }

    setValue(next: string): void {
        this.text = next;
        this.setValueCount += 1;
    }

    getLineCount(): number {
        return this.text.split('\n').length;
    }

    getLineMaxColumn(): number {
        return 1;
    }

    getPositionAt(): { lineNumber: number; column: number } {
        return { lineNumber: 1, column: 1 };
    }

    onDidChangeContent(): { dispose: () => void } {
        return { dispose: () => undefined };
    }

    dispose(): void {
        this.isDisposed = true;
        MODELS.delete(this.uri.path);
    }
}

const MODELS = new Map<string, FakeModel>();

/** Every model that has been built and not disposed, by its path. */
export function liveModels(): ReadonlyMap<string, FakeModel> {
    return MODELS;
}

export function forgetModels(): void {
    MODELS.clear();
}

export const Uri = {
    parse: (path: string) => ({ path, toString: () => path }),
};

export const editor = {
    createModel: (text: string, _language: string, uri: { path: string }): FakeModel => {
        const model = new FakeModel(text, uri.path);
        MODELS.set(uri.path, model);
        return model;
    },
    getModel: (uri: { path: string }): FakeModel | null => MODELS.get(uri.path) ?? null,
    create: vi.fn(),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
    setModelMarkers: vi.fn(),
};

export const languages = {
    typescript: {
        typescriptDefaults: {
            setCompilerOptions: vi.fn(),
            setDiagnosticsOptions: vi.fn(),
            addExtraLib: vi.fn(),
            setEagerModelSync: vi.fn(),
        },
        ScriptTarget: { ES2020: 7 },
        ModuleKind: { CommonJS: 1 },
        ModuleResolutionKind: { NodeJs: 2 },
        getTypeScriptWorker: vi.fn(),
    },
};

export const KeyMod = { CtrlCmd: 2048 };
export const KeyCode = { KeyS: 49, Escape: 9 };
export const MarkerSeverity = { Error: 8 };
