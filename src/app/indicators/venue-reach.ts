import { findMissingFacts, type VenueFact } from '../../shared/core/venue-plan.ts';
import type { IndicatorSettings, Tunable } from '../../shared/core/draw-plan.ts';

/** Anything that can say what it reads before it is asked to read it. */
interface Declaring extends Tunable {
    readonly resolveSources?: (settings: IndicatorSettings) => { readonly needs?: readonly VenueFact[] };
}

/**
 * What a layer asked of the venue that this venue does not answer.
 *
 * Empty for a layer within reach, which is every layer on the venue the chart
 * shipped against. A layer is put out of reach rather than offered and drawn
 * flat: a delta of nought on a venue that publishes no sides is a claim that
 * buying and selling were even, and it is indistinguishable from the truth.
 *
 * @param layer - The layer being offered.
 * @param settings - Its parameters, because what a layer reads can depend on them.
 * @param offered - The facts the venue was found to supply.
 * @returns The shortfall, in the order the layer named it.
 */
export function findUnreachable(
    layer: Declaring,
    settings: IndicatorSettings,
    offered: ReadonlySet<VenueFact>,
): readonly VenueFact[] {
    const needed = layer.resolveSources?.(settings).needs ?? [];
    return findMissingFacts(needed, offered);
}

/**
 * The default settings a layer is judged against before anybody has tuned it.
 *
 * A layer whose needs depend on a knob is judged on the knob it opens with,
 * which is the one the reader would get by adding it.
 *
 * @param layer - The layer being offered.
 * @returns Its parameters at their declared defaults.
 */
export function openingSettings(layer: Tunable): IndicatorSettings {
    return Object.fromEntries(
        layer.parameters.map((parameter) => [parameter.name, parameter.defaultValue]),
    );
}
