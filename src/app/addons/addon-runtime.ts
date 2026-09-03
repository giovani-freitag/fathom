import type { Indicator } from '../../shared/core/draw-plan.ts';
import * as ADDON_API from '../../shared/core/addon-api.ts';

/** What an addon's source is turned into, or why it could not be. */
export type AddonBuild =
    | { readonly kind: 'ready'; readonly indicator: Indicator }
    | { readonly kind: 'failed'; readonly message: string; readonly line?: number };

/** The specifier an addon imports the surface from. */
export const ADDON_MODULE = 'fathom';

/**
 * Runs compiled addon source and takes its default export.
 *
 * CommonJS rather than a module: the emitted `require` is a function we hand
 * over, so the surface reaches the script without an import map, a blob URL or
 * anything else the page has to resolve at run time.
 *
 * @param compiled - JavaScript the editor's compiler emitted.
 * @returns The reading it exports, or why it could not be taken.
 */
export function buildAddon(compiled: string): AddonBuild {
    const exported: Record<string, unknown> = {};
    try {
        // Running a reader's own code is the whole feature. What contains it is
        // the surface `require` will hand over and nothing else in scope.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const run = new Function('exports', 'module', 'require', compiled) as (
            exports: Record<string, unknown>,
            module: { exports: Record<string, unknown> },
            require: (specifier: string) => unknown,
        ) => void;
        const holder = { exports: exported };
        run(exported, holder, requireSurface);
        return takeIndicator(holder.exports['default'] ?? exported['default']);
    } catch (error) {
        return { kind: 'failed', message: describeFailure(error), ...findLine(error) };
    }
}

function requireSurface(specifier: string): unknown {
    if (specifier !== ADDON_MODULE) {
        throw new Error(`An addon can import only '${ADDON_MODULE}'. Asked for '${specifier}'.`);
    }
    return ADDON_API;
}

/**
 * Checks that what was exported can actually be drawn.
 *
 * Every miss is named rather than left to fail later inside the chart, where
 * the reading simply would not appear.
 */
function takeIndicator(exported: unknown): AddonBuild {
    if (exported === undefined || exported === null) {
        return { kind: 'failed', message: 'Nothing was exported. Add `export default class … `.' };
    }

    const candidate = typeof exported === 'function'
        ? tryConstruct(exported as new () => unknown)
        : exported;
    if (candidate instanceof Error) {
        return { kind: 'failed', message: candidate.message };
    }

    const missing = ['label', 'parameters', 'compute']
        .filter((field) => (candidate as Record<string, unknown>)[field] === undefined);
    if (missing.length > 0) {
        return { kind: 'failed', message: `The export is missing: ${missing.join(', ')}.` };
    }
    if (typeof (candidate as Indicator).compute !== 'function') {
        return { kind: 'failed', message: '`compute` has to be a method.' };
    }

    return { kind: 'ready', indicator: candidate as Indicator };
}

function tryConstruct(Constructor: new () => unknown): unknown {
    try {
        return new Constructor();
    } catch (error) {
        return new Error(`Could not construct the export: ${describeFailure(error)}`);
    }
}

function describeFailure(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The line of the addon's own source a thrown error came from, where known. */
function findLine(error: unknown): { line?: number } {
    const stack = error instanceof Error ? error.stack ?? '' : '';
    const found = /<anonymous>:(\d+):\d+/.exec(stack);
    // The wrapper adds two lines above the source it was given.
    return found === null ? {} : { line: Math.max(1, Number(found[1]) - 2) };
}
