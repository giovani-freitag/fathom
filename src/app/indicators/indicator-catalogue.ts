import type { Indicator, IndicatorSettings, PlotTone } from '../../shared/core/draw-plan.ts';
import { type AddedIndicator, chooseInstanceTone } from '../../shared/core/indicator-selection.ts';
import { AVERAGE_CONVERGENCE } from './average-convergence.ts';
import { type FieldLayer, FIELD_LAYERS, findFieldLayer } from './field-layers.ts';
import { AVERAGE_TRUE_RANGE } from './average-true-range.ts';
import { BOLLINGER_BANDS } from './bollinger-bands.ts';
import { DONCHIAN_CHANNELS } from './donchian-channels.ts';
import { EXPONENTIAL_AVERAGE } from './exponential-average.ts';
import { RELATIVE_STRENGTH } from './relative-strength.ts';
import { SIMPLE_AVERAGE } from './simple-average.ts';
import { STOCHASTIC_OSCILLATOR } from './stochastic-oscillator.ts';

/**
 * Every indicator the build ships with, in the order they are offered.
 *
 * Ordered so the ones drawn over the price come first: that is the division a
 * reader makes when choosing, and it is the one that decides whether adding it
 * changes the shape of the screen.
 */
export const INDICATOR_CATALOGUE: readonly Indicator[] = [
    SIMPLE_AVERAGE,
    EXPONENTIAL_AVERAGE,
    BOLLINGER_BANDS,
    DONCHIAN_CHANNELS,
    RELATIVE_STRENGTH,
    STOCHASTIC_OSCILLATOR,
    AVERAGE_CONVERGENCE,
    AVERAGE_TRUE_RANGE,
];

/**
 * Everything a reader can put on the chart, indicators and host layers alike.
 *
 * One list because choosing what to look at is one decision. The two halves
 * differ in how they are drawn, which is the host's problem rather than the
 * reader's.
 */
export const CHART_LAYERS: readonly (Indicator | FieldLayer)[] = [
    ...FIELD_LAYERS,
    ...INDICATOR_CATALOGUE,
];

/**
 * Looks up anything the reader may have added, by id.
 *
 * @param layerId - The id to find.
 * @returns The indicator or layer, or null when the build no longer ships it.
 */
export function findChartLayer(layerId: string): Indicator | FieldLayer | null {
    return CHART_LAYERS.find((layer) => layer.id === layerId) ?? null;
}

/**
 * The starting parameters for anything newly added.
 *
 * @param layer - What is being added.
 * @returns Its declared defaults, by parameter name.
 */
export function readLayerDefaults(layer: Indicator | FieldLayer): IndicatorSettings {
    const settings: Record<string, number | string | boolean> = {};
    for (const parameter of layer.parameters) {
        settings[parameter.name] = parameter.defaultValue;
    }
    return settings;
}

/**
 * Looks an indicator up by the id a stored selection refers to.
 *
 * @param indicatorId - The id to find.
 * @returns The indicator, or null when the build no longer ships it.
 */
export function findIndicator(indicatorId: string): Indicator | null {
    return INDICATOR_CATALOGUE.find((indicator) => indicator.id === indicatorId) ?? null;
}

/**
 * The deepest history any added indicator needs behind the drawn window.
 *
 * One figure for the whole set because they share a fetch: reading each one's
 * own depth would mean a request per indicator over the same range.
 *
 * @param added - What is on the chart.
 * @returns Bars to read before the window, and never fewer than one.
 */
export function resolveRequiredWarmupBars(added: readonly AddedIndicator[]): number {
    let deepest = 1;
    for (const entry of added) {
        const indicator = findIndicator(entry.indicatorId);
        if (indicator !== null) {
            deepest = Math.max(deepest, indicator.resolveWarmupBars(entry.settings));
        }
    }
    return deepest;
}

/**
 * The colour a newly added layer is identified by.
 *
 * A layer the host paints — the depth map has a ramp, the candles have two
 * colours that already mean something — takes a tone outside the rotation, so
 * it reserves nothing. Reserving one would spend an identity colour on a layer
 * that never shows it, and hand the reader's first indicator whatever was left.
 *
 * @param layer - What is being added.
 * @param added - What is already on the chart.
 * @returns The tone to draw it in.
 */
export function chooseLayerTone(
    layer: Indicator | FieldLayer,
    added: readonly AddedIndicator[],
): PlotTone {
    return findFieldLayer(layer.id) === null ? chooseInstanceTone(added) : 'muted';
}
