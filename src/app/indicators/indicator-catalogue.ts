import type {
    FieldLayer,
    HigherBarRequest,
    Indicator,
    IndicatorSettings,
    PlotTone,
    Registered,
} from '../../shared/core/draw-plan.ts';
import { type AddedIndicator, chooseInstanceTone } from '../../shared/core/indicator-selection.ts';
import { AVERAGE_CONVERGENCE } from './average-convergence/average-convergence.ts';
import { FIELD_LAYERS, findFieldLayer } from './field-layers.ts';
import { AVERAGE_TRUE_RANGE } from './average-true-range/average-true-range.ts';
import { CUMULATIVE_DELTA } from './cumulative-delta/cumulative-delta.ts';
import { VOLUME_DELTA } from './volume-delta/volume-delta.ts';
import { KELTNER_CHANNELS } from './keltner-channels/keltner-channels.ts';
import { BOLLINGER_BANDS } from './bollinger-bands/bollinger-bands.ts';
import { COMMODITY_CHANNEL } from './commodity-channel/commodity-channel.ts';
import { DIRECTIONAL_MOVEMENT } from './directional-movement/directional-movement.ts';
import { MONEY_FLOW } from './money-flow/money-flow.ts';
import { PARABOLIC_STOP } from './parabolic-stop/parabolic-stop.ts';
import { PIVOT_POINTS } from './pivot-points/pivot-points.ts';
import { SUPERTREND } from './supertrend/supertrend.ts';
import { DONCHIAN_CHANNELS } from './donchian-channels/donchian-channels.ts';
import { EXPONENTIAL_AVERAGE } from './exponential-average/exponential-average.ts';
import { RELATIVE_STRENGTH } from './relative-strength/relative-strength.ts';
import { SIMPLE_AVERAGE } from './simple-average/simple-average.ts';
import { STOCHASTIC_OSCILLATOR } from './stochastic-oscillator/stochastic-oscillator.ts';
import { VOLUME, VOLUME_ID } from './volume/volume.ts';
import { VOLUME_WEIGHTED_AVERAGE } from './volume-weighted-average/volume-weighted-average.ts';

/**
 * Every indicator the build ships with, in the order they are offered.
 *
 * Ordered so the ones drawn over the price come first: that is the division a
 * reader makes when choosing, and it is the one that decides whether adding it
 * changes the shape of the screen.
 */
export const INDICATOR_CATALOGUE: readonly Registered<Indicator>[] = [
    { id: VOLUME_ID, layer: VOLUME },
    { id: 'sma', layer: SIMPLE_AVERAGE },
    { id: 'vwap', layer: VOLUME_WEIGHTED_AVERAGE },
    { id: 'pivots', layer: PIVOT_POINTS },
    { id: 'ema', layer: EXPONENTIAL_AVERAGE },
    { id: 'bollinger', layer: BOLLINGER_BANDS },
    { id: 'donchian', layer: DONCHIAN_CHANNELS },
    { id: 'keltner', layer: KELTNER_CHANNELS },
    { id: 'supertrend', layer: SUPERTREND },
    { id: 'psar', layer: PARABOLIC_STOP },
    { id: 'rsi', layer: RELATIVE_STRENGTH },
    { id: 'stochastic', layer: STOCHASTIC_OSCILLATOR },
    { id: 'macd', layer: AVERAGE_CONVERGENCE },
    { id: 'atr', layer: AVERAGE_TRUE_RANGE },
    { id: 'adx', layer: DIRECTIONAL_MOVEMENT },
    { id: 'mfi', layer: MONEY_FLOW },
    { id: 'cci', layer: COMMODITY_CHANNEL },
    { id: 'delta', layer: VOLUME_DELTA },
    { id: 'cvd', layer: CUMULATIVE_DELTA },
];
/**
 * Everything a reader can put on the chart, indicators and host layers alike.
 *
 * One list because choosing what to look at is one decision. The two halves
 * differ in how they are drawn, which is the host's problem rather than the
 * reader's.
 */
export const CHART_LAYERS: readonly Registered<Indicator | FieldLayer>[] = [
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
    return CHART_LAYERS.find((entry) => entry.id === layerId)?.layer ?? null;
}

/**
 * The starting parameters for anything newly added.
 *
 * @param layerId - The id being added.
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
    return INDICATOR_CATALOGUE.find((entry) => entry.id === indicatorId)?.layer ?? null;
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
/**
 * The coarser rungs everything on the chart between them reads.
 *
 * Merged rather than listed per indicator: two copies of a reading anchored to
 * the same session are one fetch, and the deeper warm-up covers the shallower.
 *
 * @param added - What the reader has put on the chart.
 * @returns One request per rung, or none where nothing reads another.
 */
export function resolveRequiredHigherBars(
    added: readonly AddedIndicator[],
): readonly HigherBarRequest[] {
    const deepest = new Map<number, number>();
    for (const entry of added) {
        const indicator = findIndicator(entry.indicatorId);
        for (const request of indicator?.resolveHigherIntervals?.(entry.settings) ?? []) {
            const held = deepest.get(request.intervalMs) ?? 0;
            deepest.set(request.intervalMs, Math.max(held, request.warmupBars));
        }
    }

    return [...deepest].map(([intervalMs, warmupBars]) => ({ intervalMs, warmupBars }));
}

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
 * @param layerId - The id being added.
 * @param added - What is already on the chart.
 * @returns The tone to draw it in.
 */
export function chooseLayerTone(layerId: string, added: readonly AddedIndicator[]): PlotTone {
    return findFieldLayer(layerId) === null ? chooseInstanceTone(added) : 'muted';
}

/**
 * What a chart shows before anybody has chosen anything.
 *
 * The book, the price, and how much traded in it: a chart that opens on less
 * than the price and its volume asks the reader to assemble the ordinary case
 * by hand before they can read anything at all.
 */
export const OPENING_LAYERS: readonly Registered<Indicator | FieldLayer>[] = [
    ...FIELD_LAYERS,
    { id: VOLUME_ID, layer: VOLUME },
];
