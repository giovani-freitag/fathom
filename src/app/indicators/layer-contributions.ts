import type { AddedIndicator } from '../../shared/core/indicator-selection.ts';
import { BOOK_LAYER } from './book/book.ts';
import { BookPanel } from './book/book-panel.tsx';
import { CandleReadout } from './candles/candle-readout.tsx';
import { CANDLES_LAYER } from './candles/candles.ts';
import type { ChartState } from '../core/chart-controller.ts';
import type { ComponentType } from 'react';
import type { FieldLayer, Indicator } from '../../shared/core/draw-plan.ts';
import { DepthLegend } from './book/depth-legend.tsx';

/** What a layer puts into the shell beyond the plan or the pixels it draws. */
export interface LayerContribution {
    /** Controls shown inside the layer's own settings card. */
    readonly Panel?: ComponentType<LayerViewProps>;
    /**
     * A mark shown over the chart while the layer is on it.
     *
     * Reads the window itself rather than being handed it: what it shows
     * changes far more often than the row or the page that mounts it, and
     * passing the whole window down would rebuild both on every change.
     */
    readonly Overlay?: ComponentType;
    /** What it reads under the cursor, shown beside its name in the legend. */
    readonly Readout?: ComponentType;
    /** False for a layer that must not be taken off the chart. */
    readonly isRemovable?: boolean;
}

export interface LayerViewProps {
    readonly state: ChartState;
}

/**
 * What each layer contributes, by the id it is added under.
 *
 * The shell reads this rather than naming a layer: a card that holds a panel, a
 * chart that carries a mark, and a row with no remove button are all a layer
 * saying so, not the shell knowing which one it is.
 */
const CONTRIBUTIONS: Readonly<Record<string, LayerContribution>> = {
    // The book holds what is being recorded, and a control that goes away with
    // it is a collector nobody can stop. Hiding it leaves the same chart behind.
    [BOOK_LAYER.id]: { Panel: BookPanel, Overlay: DepthLegend, isRemovable: false },
    [CANDLES_LAYER.id]: { Readout: CandleReadout },
};

/**
 * What a layer contributes to the shell.
 *
 * @param layerId - The id it is added under.
 * @returns Its contribution, or null when it makes none.
 */
export function findLayerContribution(layerId: string): LayerContribution | null {
    return CONTRIBUTIONS[layerId] ?? null;
}

export interface DrawnOverlay {
    readonly instanceId: string;
    readonly Overlay: ComponentType;
}

/**
 * The marks the layers on the chart put over it.
 *
 * @param added - Everything on the chart.
 * @returns One entry per drawn layer that carries a mark.
 */
export function listDrawnOverlays(added: readonly AddedIndicator[]): readonly DrawnOverlay[] {
    const drawn: DrawnOverlay[] = [];
    for (const entry of added) {
        const Overlay = findLayerContribution(entry.indicatorId)?.Overlay;
        if (entry.isHidden === true || Overlay === undefined) {
            continue;
        }
        drawn.push({ instanceId: entry.instanceId, Overlay });
    }
    return drawn;
}

/**
 * Whether a layer has anything to open onto.
 *
 * A control that opens onto an empty panel teaches a reader that opening is not
 * worth it, so a layer with nothing to be told does not offer one.
 *
 * @param layer - The layer as the build ships it.
 * @returns True when it declares a knob or brought a panel.
 */
export function isLayerTunable(layer: Indicator | FieldLayer): boolean {
    return layer.parameters.length > 0 || findLayerContribution(layer.id)?.Panel !== undefined;
}
