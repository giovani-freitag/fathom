import { useCallback, useMemo, useState } from 'react';
import {
    MAXIMUM_STORED_INDICATORS,
    withIndicatorAdded,
    withIndicatorBanded,
    withIndicatorRemoved,
    withIndicatorRecoloured,
    withIndicatorRestored,
    withIndicatorVisibility,
    withIndicatorRetuned,
} from '../../shared/core/indicator-selection.ts';
import type { PlotTone } from '../../shared/core/draw-plan.ts';
import type { AddedIndicator } from '../../shared/core/indicator-selection.ts';
import { findChartLayer, readLayerDefaults } from '../indicators/indicator-catalogue.ts';
import { useChartState } from './use-chart-state.ts';
import { useKernel } from './kernel-context.ts';

export interface IndicatorControls {
    readonly added: readonly AddedIndicator[];
    readonly isFull: boolean;
    readonly add: (indicatorId: string) => void;
    readonly remove: (instanceId: string) => void;
    readonly retune: (instanceId: string, name: string, value: number | string) => void;
    readonly recolour: (instanceId: string, tone: PlotTone) => void;
    readonly setVisibility: (instanceId: string, isHidden: boolean) => void;
    readonly setBand: (instanceId: string, bandKey: string | null) => void;
    /** How many copies of each indicator are on the chart, by indicator id. */
    readonly addedCounts: ReadonlyMap<string, number>;
    /** The last removal, until it is undone or another change lands. */
    readonly lastRemoved: AddedIndicator | null;
    readonly undoRemoval: () => void;
    readonly forgetRemoval: () => void;
}

/**
 * The set of indicators on the chart, and the three things a reader does to it.
 *
 * @returns The set and the operations over it.
 */
export function useIndicators(): IndicatorControls {
    const kernel = useKernel();
    const added = useChartState().addedIndicators;

    const add = useCallback((indicatorId: string) => {
        const layer = findChartLayer(indicatorId);
        if (layer !== null) {
            const settings = readLayerDefaults(layer);
            kernel.chart.updateIndicators(
                (current) => withIndicatorAdded(current, indicatorId, settings),
            );
        }
    }, [kernel]);

    const [removal, setRemoval] = useState<{ entry: AddedIndicator; index: number } | null>(null);

    const remove = useCallback((instanceId: string) => {
        kernel.chart.updateIndicators((current) => {
            const index = current.findIndex((entry) => entry.instanceId === instanceId);
            const entry = current[index];
            // Held so the removal can be taken back. An indicator someone tuned
            // is minutes of work, and one stray click is all it takes.
            setRemoval(entry === undefined ? null : { entry, index });
            return withIndicatorRemoved(current, instanceId);
        });
    }, [kernel]);

    const undoRemoval = useCallback(() => {
        if (removal !== null) {
            kernel.chart.updateIndicators(
                (current) => withIndicatorRestored(current, removal.entry, removal.index),
            );
            setRemoval(null);
        }
    }, [kernel, removal]);

    const forgetRemoval = useCallback(() => { setRemoval(null); }, []);

    const retune = useCallback((instanceId: string, name: string, value: number | string) => {
        kernel.chart.updateIndicators(
            (current) => withIndicatorRetuned(current, instanceId, name, value),
        );
    }, [kernel]);

    const recolour = useCallback((instanceId: string, tone: PlotTone) => {
        kernel.chart.updateIndicators(
            (current) => withIndicatorRecoloured(current, instanceId, tone),
        );
    }, [kernel]);

    const setVisibility = useCallback((instanceId: string, isHidden: boolean) => {
        kernel.chart.updateIndicators(
            (current) => withIndicatorVisibility(current, instanceId, isHidden),
        );
    }, [kernel]);

    const setBand = useCallback((instanceId: string, bandKey: string | null) => {
        kernel.chart.updateIndicators(
            (current) => withIndicatorBanded(current, instanceId, bandKey),
        );
    }, [kernel]);

    const addedCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const entry of added) {
            counts.set(entry.indicatorId, (counts.get(entry.indicatorId) ?? 0) + 1);
        }
        return counts;
    }, [added]);

    return useMemo(() => ({
        added,
        addedCounts,
        // Only a document guard, never a product limit: what is too many is
        // something the reader can see on the chart and decide about.
        isFull: added.length >= MAXIMUM_STORED_INDICATORS,
        add,
        remove,
        retune,
        recolour,
        setVisibility,
        setBand,
        lastRemoved: removal?.entry ?? null,
        undoRemoval,
        forgetRemoval,
    }), [added, addedCounts, add, remove, retune, recolour, setVisibility, setBand, removal, undoRemoval, forgetRemoval]);
}
