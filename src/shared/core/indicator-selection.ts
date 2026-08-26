import { INSTANCE_TONES, type IndicatorSettings, type PlotTone } from './draw-plan.ts';

/**
 * One indicator a reader has added, with the parameters they chose.
 *
 * Carries an instance id of its own so the same indicator can be added twice at
 * different settings — a fast average and a slow one is the ordinary case, not
 * an edge one.
 */
export interface AddedIndicator {
    readonly instanceId: string;
    readonly indicatorId: string;
    readonly settings: IndicatorSettings;
    /**
     * What this copy is drawn in, so two of the same indicator can be told apart.
     *
     * Carried by the copy rather than by the indicator, because the thing that
     * needs distinguishing is which of two identical averages a line belongs to,
     * and the indicator has no idea there are two.
     */
    readonly tone: PlotTone;
    /**
     * Kept but not drawn.
     *
     * Distinct from removing it: the parameters someone tuned survive, and a
     * band that is not being read stops taking room from the price.
     */
    readonly isHidden?: boolean;
    /**
     * Which band it is drawn in, where several share one.
     *
     * Absent means a band of its own. Two readings on the same scale — the same
     * oscillator at two periods, most often — say nothing to each other in
     * separate bands with separate ranges, which is the whole reason for having
     * two of them.
     */
    readonly bandKey?: string;
}

/**
 * How many a stored document may hold.
 *
 * Not a product limit. Bands thin out as they are added and the price keeps a
 * floor, so what is too many is something a reader can see and decide about —
 * and two readings put in one band cost one band, not two. This figure is a
 * guard on a document that arrives corrupt or hand-edited, set far above any
 * chart somebody would actually build.
 */
export const MAXIMUM_STORED_INDICATORS = 64;

/**
 * Mints an id for a newly added indicator.
 *
 * Derived from what is already added rather than from a clock, so the same
 * sequence of actions produces the same document whenever it is replayed.
 *
 * @param indicatorId - The indicator being added.
 * @param added - What is already on the chart.
 * @returns An id no member of `added` is using.
 */
export function mintInstanceId(
    indicatorId: string,
    added: readonly AddedIndicator[],
): string {
    const taken = new Set(added.map((entry) => entry.instanceId));
    for (let ordinal = 1; ; ordinal += 1) {
        const candidate = `${indicatorId}-${ordinal}`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
}

/**
 * Adds an indicator at its declared defaults.
 *
 * @param added - What is already on the chart.
 * @param indicatorId - The indicator to add.
 * @param settings - Its starting parameters.
 * @returns The new set, unchanged once it is full.
 */
export function withIndicatorAdded(
    added: readonly AddedIndicator[],
    indicatorId: string,
    settings: IndicatorSettings,
): readonly AddedIndicator[] {
    if (added.length >= MAXIMUM_STORED_INDICATORS) {
        return added;
    }
    return [...added, {
        instanceId: mintInstanceId(indicatorId, added),
        indicatorId,
        settings,
        tone: chooseInstanceTone(added),
    }];
}

/**
 * Picks a colour nothing on the chart is already using.
 *
 * @param added - What is already on the chart.
 * @returns A free tone, or the next in rotation once every one is taken.
 */
export function chooseInstanceTone(added: readonly AddedIndicator[]): PlotTone {
    const taken = new Set(added.map((entry) => entry.tone));
    return INSTANCE_TONES.find((tone) => !taken.has(tone))
        ?? INSTANCE_TONES[added.length % INSTANCE_TONES.length]!;
}

/**
 * Changes what one added indicator is drawn in.
 *
 * @param added - What is on the chart.
 * @param instanceId - Which copy to recolour.
 * @param tone - Its new colour.
 * @returns The new set, in the order it was already in.
 */
export function withIndicatorRecoloured(
    added: readonly AddedIndicator[],
    instanceId: string,
    tone: PlotTone,
): readonly AddedIndicator[] {
    return added.map((entry) => (
        entry.instanceId === instanceId ? { ...entry, tone } : entry
    ));
}

/**
 * Drops one added indicator.
 *
 * @param added - What is on the chart.
 * @param instanceId - Which copy to drop.
 * @returns The new set.
 */
export function withIndicatorRemoved(
    added: readonly AddedIndicator[],
    instanceId: string,
): readonly AddedIndicator[] {
    return added.filter((entry) => entry.instanceId !== instanceId);
}

/**
 * Changes one parameter of one added indicator.
 *
 * @param added - What is on the chart.
 * @param instanceId - Which copy to retune.
 * @param name - The parameter to change.
 * @param value - Its new value.
 * @returns The new set, in the order it was already in.
 */
export function withIndicatorRetuned(
    added: readonly AddedIndicator[],
    instanceId: string,
    name: string,
    value: number | string,
): readonly AddedIndicator[] {
    return added.map((entry) => (
        entry.instanceId === instanceId
            ? { ...entry, settings: { ...entry.settings, [name]: value } }
            : entry
    ));
}

/**
 * Puts a removed indicator back where it was.
 *
 * At its old position rather than at the end, because the order decides which
 * band an indicator is drawn in: restoring to the end would move every other
 * oscillator up a pane, which is not what undoing a removal means.
 *
 * @param added - What is on the chart.
 * @param entry - The indicator to restore.
 * @param index - Where it sat before it was removed.
 * @returns The new set.
 */
export function withIndicatorRestored(
    added: readonly AddedIndicator[],
    entry: AddedIndicator,
    index: number,
): readonly AddedIndicator[] {
    if (added.length >= MAXIMUM_STORED_INDICATORS
        || added.some((existing) => existing.instanceId === entry.instanceId)) {
        return added;
    }

    const restored = [...added];
    restored.splice(Math.min(Math.max(index, 0), added.length), 0, entry);
    return restored;
}

/**
 * Draws or stops drawing one added indicator, keeping how it was tuned.
 *
 * @param added - What is on the chart.
 * @param instanceId - Which copy to change.
 * @param isHidden - True to keep it without drawing it.
 * @returns The new set, in the order it was already in.
 */
export function withIndicatorVisibility(
    added: readonly AddedIndicator[],
    instanceId: string,
    isHidden: boolean,
): readonly AddedIndicator[] {
    return added.map((entry) => (
        entry.instanceId === instanceId ? { ...entry, isHidden } : entry
    ));
}

/**
 * The band an added indicator is drawn in.
 *
 * @param entry - The indicator.
 * @returns Its band, which is its own unless it was put in another.
 */
export function resolveBandKey(entry: AddedIndicator): string {
    return entry.bandKey ?? entry.instanceId;
}

/**
 * Moves one indicator into another's band, or back into a band of its own.
 *
 * @param added - What is on the chart.
 * @param instanceId - Which copy to move.
 * @param bandKey - The band to join, or null to leave it alone in one.
 * @returns The new set, in the order it was already in.
 */
export function withIndicatorBanded(
    added: readonly AddedIndicator[],
    instanceId: string,
    bandKey: string | null,
): readonly AddedIndicator[] {
    return added.map((entry) => {
        if (entry.instanceId !== instanceId) {
            return entry;
        }
        if (bandKey === null) {
            const rest = { ...entry };
            delete (rest as { bandKey?: string }).bandKey;
            return rest;
        }
        return { ...entry, bandKey };
    });
}
