import type { AddedIndicator } from '../../shared/core/indicator-selection.ts';
import type { FieldLayer, IndicatorSettings, Registered } from '../../shared/core/draw-plan.ts';
import { type BookSettings, BOOK_LAYER, BOOK_LAYER_ID, readBookSettings } from './book/book.ts';
import { type CandleSettings, CANDLES_LAYER, CANDLES_LAYER_ID, readCandleSettings } from './candles/candles.ts';

/**
 * The layers the chart draws itself, in the order they are offered.
 *
 * Each declares itself in its own folder; this only says which ones the build
 * ships and reads what the reader has chosen across them.
 */
export const FIELD_LAYERS: readonly Registered<FieldLayer>[] = [
    { id: BOOK_LAYER_ID, layer: BOOK_LAYER },
    { id: CANDLES_LAYER_ID, layer: CANDLES_LAYER },
];

/** What the layers currently on the chart amount to, for the parts that draw them. */
/** What each drawn layer is tuned to, by the id it was added under. */
export type LayerSettings = Readonly<Record<string, IndicatorSettings>>;

export interface FieldSettings extends BookSettings, CandleSettings {
    readonly layerSettings: LayerSettings;
}

/**
 * Reads the host layers out of what the reader has added.
 *
 * Derived rather than stored beside the list, so there is one answer to what is
 * on the chart and it is the list itself.
 *
 * @param added - Everything on the chart.
 * @returns Which host layers are drawn, and how each is tuned.
 */
export function resolveFieldSettings(added: readonly AddedIndicator[]): FieldSettings {
    const drawn = new Map(added
        .filter((entry) => entry.isHidden !== true && findFieldLayer(entry.indicatorId) !== null)
        .map((entry) => [entry.indicatorId, entry.settings]));

    return {
        ...readBookSettings(drawn.get(BOOK_LAYER_ID)),
        ...readCandleSettings(drawn.get(CANDLES_LAYER_ID)),
        layerSettings: Object.fromEntries(drawn),
    };
}

/**
 * Looks a layer up by the id a stored selection refers to.
 *
 * @param layerId - The id to find.
 * @returns The layer, or null when it names something else.
 */
export function findFieldLayer(layerId: string): FieldLayer | null {
    return FIELD_LAYERS.find((entry) => entry.id === layerId)?.layer ?? null;
}
