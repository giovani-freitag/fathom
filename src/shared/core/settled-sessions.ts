import type { PriceBar, PriceBarWindow } from './price-bar.ts';
import type { SessionRequest, SettledSessions } from './draw-plan.ts';
import { NO_SESSIONS } from './draw-plan.ts';

/**
 * The newest coarser bar that had already closed, for each bar of a window.
 *
 * This is the whole of what reading a coarser rung honestly amounts to. A daily
 * level drawn on a minute chart is a level the day *before* agreed on, and the
 * day being drawn through has not finished having its say: taking the figures
 * off a bar that is still forming shows the reader, at nine in the morning,
 * something that will not be true until midnight.
 *
 * A bar closing exactly when a drawn bar opens counts as settled. That is the
 * instant it became knowable, and holding it back a bar would draw yesterday's
 * level a minute into today.
 *
 * @param bars - The window being drawn, oldest first.
 * @param higher - Bars of the coarser rung, oldest first.
 * @returns One entry per drawn bar, undefined where nothing had closed yet.
 */
export function holdLastClosed(
    bars: readonly PriceBar[],
    higher: readonly PriceBar[],
): readonly (PriceBar | undefined)[] {
    return walkSettled(bars, higher).perBar;
}

/**
 * The same walk, keeping where each drawn bar landed as well as what it landed on.
 *
 * @param bars - The window being drawn, oldest first.
 * @param higher - Bars of the coarser rung, oldest first.
 * @returns What each drawn bar knew, and how far the walk got.
 */
function walkSettled(bars: readonly PriceBar[], higher: readonly PriceBar[]): {
    readonly perBar: readonly (PriceBar | undefined)[];
    readonly indexPerBar: Int32Array;
    /** How many of `higher` had settled by the last drawn bar. */
    readonly reached: number;
} {
    const perBar: (PriceBar | undefined)[] = [];
    const indexPerBar = new Int32Array(bars.length);
    let cursor = 0;
    let settled: PriceBar | undefined;

    // One walk of each, not a search per bar: both are in order, so the coarser
    // cursor only ever moves forward.
    for (const [at, bar] of bars.entries()) {
        while (cursor < higher.length && higher[cursor]!.closedAtMs <= bar.openedAtMs) {
            settled = higher[cursor]!;
            cursor += 1;
        }
        perBar.push(settled);
        indexPerBar[at] = cursor - 1;
    }

    return { perBar, indexPerBar, reached: cursor };
}

/**
 * Aligns a coarser rung to the drawn bars, holding each back to what it knew.
 *
 * Run by the host, so a reading has nothing to remember to do and no raw
 * window to reach into.
 *
 * @param bars - The window being drawn.
 * @param higher - The coarser bars the archive supplied, or null where it had none.
 * @returns The sessions aligned to the drawn bars, with their turnovers marked.
 */
export function alignSessions(
    bars: readonly PriceBar[],
    higher: readonly PriceBar[] | null,
): SettledSessions {
    if (higher === null || higher.length === 0) {
        return blankFor(bars);
    }

    const { perBar, indexPerBar, reached } = walkSettled(bars, higher);
    const turnsOver = new Uint8Array(perBar.length);
    let hasAny = false;

    for (const [index, settled] of perBar.entries()) {
        hasAny = hasAny || settled !== undefined;
        if (index > 0 && settled !== perBar[index - 1]) {
            turnsOver[index] = 1;
        }
    }

    // Cut at the walk rather than handed over whole. The fetch reaches past the
    // last drawn bar and its newest bar may still be forming, and a reading
    // that averaged that one would show a figure that moves after the fact.
    return { hasAny, perBar, turnsOver, closed: higher.slice(0, reached), indexPerBar };
}

/**
 * The sessions one reading declared, under the names it declared them with.
 *
 * @param bars - The window being drawn.
 * @param supplied - The coarser windows fetched for the chart, by rung.
 * @param declared - What this reading asked for.
 * @returns One entry per declared name, blank where the archive had no rung.
 */
export function collectSessions(
    bars: readonly PriceBar[],
    supplied: ReadonlyMap<number, PriceBarWindow>,
    declared: Readonly<Record<string, SessionRequest>> | undefined,
): Readonly<Record<string, SettledSessions>> {
    if (declared === undefined) {
        return {};
    }

    const collected: Record<string, SettledSessions> = {};
    for (const [name, request] of Object.entries(declared)) {
        const window = supplied.get(request.intervalMs);
        // Present and blank rather than absent: no venue publishes a candle for
        // every rung, and "nothing to draw" must not read as "declared nothing".
        collected[name] = window === undefined ? blankFor(bars) : alignSessions(bars, window.bars);
    }

    return collected;
}

/** A rung the archive had nothing for, sized to the window all the same. */
function blankFor(bars: readonly PriceBar[]): SettledSessions {
    return {
        ...NO_SESSIONS,
        perBar: bars.map(() => undefined),
        turnsOver: new Uint8Array(bars.length),
        indexPerBar: new Int32Array(bars.length).fill(-1),
    };
}
