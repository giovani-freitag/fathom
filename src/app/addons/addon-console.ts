import { ObservableStore } from '../core/observable-store.ts';

/** How a line was printed, which is all the colour it gets. */
export type LogLevel = 'log' | 'warn' | 'error';

/** One line a reader's script printed. */
export interface AddonLogLine {
    readonly level: LogLevel;
    readonly text: string;
    /** Which reading printed it, empty while its script is still being built. */
    readonly from: string;
    /** How many times running the same line was printed. */
    readonly repeats: number;
}

/**
 * How many lines are kept.
 *
 * A reading is redrawn on every bar, every pan and every zoom, so a print
 * inside `compute` arrives faster than anybody reads. What is worth keeping is
 * the last of it.
 */
const KEPT_LINES = 200;

/** How deep a printed value is opened before it is left as its own kind. */
const OPENED_DEPTH = 2;

/** How much of a list or an object is shown before the rest is counted. */
const SHOWN_ITEMS = 12;

const store = new ObservableStore<readonly AddonLogLine[]>({ initialState: [] });

let pending: AddonLogLine[] = [];
let isFlushScheduled = false;

/** Everything the readers' scripts have printed, newest last. */
export const addonLog = store;

/** Empties the console. */
export function clearAddonLog(): void {
    pending = [];
    store.write([]);
}

/**
 * A console for a reader's script.
 *
 * Its own rather than the page's: what a reading prints belongs beside the
 * reading, and handing over the real console would put a script's output in
 * with the chart's own and let it call things like `profile` on the browser.
 *
 * @param named - What the reading calls itself, asked at the moment of the
 *     print because a script prints while it is being built, before it has
 *     said what it is called.
 * @returns Something a script can call `log`, `warn` and `error` on.
 */
export function buildAddonConsole(
    named: () => string = () => '',
): Pick<Console, 'log' | 'info' | 'debug' | 'warn' | 'error'> {
    return {
        log: (...values: readonly unknown[]) => { record('log', values, named); },
        info: (...values: readonly unknown[]) => { record('log', values, named); },
        debug: (...values: readonly unknown[]) => { record('log', values, named); },
        warn: (...values: readonly unknown[]) => { record('warn', values, named); },
        error: (...values: readonly unknown[]) => { record('error', values, named); },
    };
}

function record(level: LogLevel, values: readonly unknown[], named: () => string): void {
    pending.push({
        level,
        text: values.map((value) => describe(value, OPENED_DEPTH, new WeakSet())).join(' '),
        from: named(),
        repeats: 1,
    });

    // Published once a turn rather than once a line: a print inside a loop over
    // the drawn bars is hundreds of calls in one go, and each one landing on
    // its own would rebuild the list hundreds of times.
    if (!isFlushScheduled) {
        isFlushScheduled = true;
        queueMicrotask(flush);
    }
}

function flush(): void {
    isFlushScheduled = false;
    const grown = [...store.read()];
    for (const line of pending) {
        const last = grown[grown.length - 1];
        // Counted against what is already shown rather than only against this
        // turn's own lines: the ordinary case is one print per redraw, which
        // arrives a turn apart and would otherwise never be seen as a repeat.
        if (last !== undefined
            && last.level === line.level
            && last.text === line.text
            && last.from === line.from) {
            grown[grown.length - 1] = { ...last, repeats: last.repeats + line.repeats };
        } else {
            grown.push(line);
        }
    }
    pending = [];
    store.write(grown.length > KEPT_LINES ? grown.slice(grown.length - KEPT_LINES) : grown);
}

function describe(value: unknown, depth: number, seen: WeakSet<object>): string {
    if (typeof value === 'string') {
        return depth === OPENED_DEPTH ? value : JSON.stringify(value);
    }
    if (value === null || value === undefined || typeof value !== 'object') {
        return describePlain(value);
    }
    if (seen.has(value)) {
        return '[circular]';
    }
    if (depth <= 0) {
        return Array.isArray(value) ? '[…]' : '{…}';
    }

    seen.add(value);
    return describeOpened(value, depth, seen);
}

function describePlain(value: unknown): string {
    if (typeof value === 'function') {
        return `ƒ ${value.name || 'anonymous'}()`;
    }
    if (typeof value === 'bigint') {
        return `${value}n`;
    }
    return String(value);
}

function describeOpened(value: object, depth: number, seen: WeakSet<object>): string {
    if (value instanceof Error) {
        return `${value.name}: ${value.message}`;
    }
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        // Every series the chart works in is a typed array, so this is the
        // shape a reader prints most and the one a bare `[object Object]`
        // helps least with.
        const numbers = [...(value as unknown as ArrayLike<number>) as never as number[]];
        return `${value.constructor.name}(${numbers.length}) [${listOf(numbers, depth, seen)}]`;
    }
    if (Array.isArray(value)) {
        return `[${listOf(value, depth, seen)}]`;
    }

    const entries = Object.entries(value);
    const shown = entries.slice(0, SHOWN_ITEMS)
        .map(([key, held]) => `${key}: ${describe(held, depth - 1, seen)}`);
    return `{ ${[...shown, ...countRest(entries.length)].join(', ')} }`;
}

function listOf(values: readonly unknown[], depth: number, seen: WeakSet<object>): string {
    const shown = values.slice(0, SHOWN_ITEMS).map((held) => describe(held, depth - 1, seen));
    return [...shown, ...countRest(values.length)].join(', ');
}

function countRest(total: number): readonly string[] {
    return total > SHOWN_ITEMS ? [`…${total - SHOWN_ITEMS} more`] : [];
}
