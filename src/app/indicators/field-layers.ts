import type { AddedIndicator } from '../../shared/core/indicator-selection.ts';
import { type IndicatorParameter, type NumericParameter, readSetting } from '../../shared/core/draw-plan.ts';
import { DEPTH_CUT_RANGE } from '../core/chart-dataset.ts';

/**
 * A layer the host draws itself, rather than one built from arithmetic.
 *
 * The depth map is the reason this exists. It is a picture of hundreds of
 * thousands of cells built from the book, not a handful of vertices built from
 * bars, and it is painted on a layer of its own so that dragging the chart is a
 * blit rather than a repaint. None of that fits what an indicator returns.
 *
 * What it does share with an indicator is everything the reader touches: it is
 * added, tuned, hidden and removed the same way, from the same list.
 */
export interface FieldLayer {
    readonly id: FieldLayerId;
    readonly labelKey: string;
    readonly parameters: readonly IndicatorParameter[];
}

export type FieldLayerId = 'depth' | 'candles' | 'executions' | 'profile';

const COLOUR_GAIN: NumericParameter = {
    name: 'colourGain',
    kind: 'decimal',
    defaultValue: 1,
    minimum: 0.4,
    maximum: 3,
};

const FLOOR_PERCENTILE: NumericParameter = {
    name: 'floorPercentile',
    kind: 'decimal',
    defaultValue: 0.4,
    minimum: DEPTH_CUT_RANGE.floorMinimum,
    maximum: DEPTH_CUT_RANGE.floorMaximum,
};

const SATURATION_PERCENTILE: NumericParameter = {
    name: 'saturationPercentile',
    kind: 'decimal',
    defaultValue: 0.995,
    minimum: DEPTH_CUT_RANGE.saturationMinimum,
    maximum: DEPTH_CUT_RANGE.saturationMaximum,
};

/**
 * The layers the chart can draw from the recording itself.
 *
 * Offered beside the indicators because a reader choosing what to look at is
 * making one decision, not two. Taking the depth map off leaves a plain candle
 * chart, which is a thing somebody might genuinely want.
 */
export const FIELD_LAYERS: readonly FieldLayer[] = [
    { id: 'depth', labelKey: 'layer.depth', parameters: [COLOUR_GAIN, FLOOR_PERCENTILE, SATURATION_PERCENTILE] },
    { id: 'candles', labelKey: 'layer.candles', parameters: [] },
    { id: 'executions', labelKey: 'layer.executions', parameters: [] },
    { id: 'profile', labelKey: 'layer.profile', parameters: [] },
];

/** What the layers currently on the chart amount to, for the parts that draw them. */
export interface FieldSettings {
    readonly isDepthVisible: boolean;
    readonly isCandleOverlayVisible: boolean;
    readonly isTradeOverlayVisible: boolean;
    readonly isVolumeProfileVisible: boolean;
    readonly colourGain: number;
    readonly depthFloorPercentile: number;
    readonly depthSaturationPercentile: number;
}

/**
 * Reads the host layers out of what the reader has added.
 *
 * Derived rather than stored beside the list, so there is one answer to what is
 * on the chart and it is the list itself.
 *
 * @param added - Everything on the chart.
 * @returns Which host layers are drawn, and how the depth map is cut.
 */
export function resolveFieldSettings(added: readonly AddedIndicator[]): FieldSettings {
    const drawn = new Map(added
        .filter((entry) => entry.isHidden !== true && findFieldLayer(entry.indicatorId) !== null)
        .map((entry) => [entry.indicatorId, entry.settings]));
    const depth = drawn.get('depth');

    return {
        isDepthVisible: depth !== undefined,
        isCandleOverlayVisible: drawn.has('candles'),
        isTradeOverlayVisible: drawn.has('executions'),
        isVolumeProfileVisible: drawn.has('profile'),
        colourGain: readSetting(depth ?? {}, COLOUR_GAIN),
        depthFloorPercentile: readSetting(depth ?? {}, FLOOR_PERCENTILE),
        depthSaturationPercentile: readSetting(depth ?? {}, SATURATION_PERCENTILE),
    };
}

/**
 * Looks a layer up by the id a stored selection refers to.
 *
 * @param layerId - The id to find.
 * @returns The layer, or null when it names something else.
 */
export function findFieldLayer(layerId: string): FieldLayer | null {
    return FIELD_LAYERS.find((layer) => layer.id === layerId) ?? null;
}
