import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { AddedIndicator } from '../../../../src/shared/core/indicator-selection.ts';
import type { Drawing } from '../../../../src/shared/core/drawing.ts';
import type { DrawingControls } from '../../../../src/app/react/use-drawings.ts';
import { ChartProperties } from '../../../../src/app/ui/chart-properties.tsx';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import { createIndicatorKernel, type IndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';
import { useIndicators } from '../../../../src/app/react/use-indicators.ts';

const AVERAGE = { instanceId: 'sma-1', indicatorId: 'sma', settings: { periodBars: 20 }, tone: 'phosphor' as const };

const LEVEL: Drawing = {
    id: 'level',
    kind: 'horizontal-line',
    instrumentSymbol: 'BTCUSDT',
    anchors: [{ atMs: 1_000, price: 100 }],
    tone: 'phosphor',
};

function buildDrawings(selected: Drawing | null): DrawingControls {
    return {
        armedTool: null,
        selectedId: selected?.id ?? null,
        selected,
        canUndo: false,
        canRedo: false,
        toggleTool: () => undefined,
        disarm: () => undefined,
        restyleSelected: () => undefined,
        removeSelected: () => undefined,
        undo: () => undefined,
        redo: () => undefined,
    };
}

/** The slot as the page mounts it, over a chart carrying one average. */
function renderSlot(
    selected: Drawing | null,
    pickedId: string | null,
    added: readonly AddedIndicator[] = [AVERAGE],
): IndicatorKernel {
    const kernel = createIndicatorKernel(added);

    function Slot(): ReactElement {
        return <ChartProperties drawings={buildDrawings(selected)} indicators={useIndicators()} />;
    }

    render(<KernelProvider container={kernel.container}><Slot /></KernelProvider>);
    act(() => { kernel.container.chart.pickLayer(pickedId); });
    return kernel;
}

describe('ChartProperties', () => {
    it('stays away while nothing on the chart is picked', () => {
        renderSlot(null, null);

        expect(screen.queryByRole('group')).toBeNull();
    });

    it('opens the mark that is selected', () => {
        renderSlot(LEVEL, null);

        expect(screen.getByRole('group', { name: EN_DICTIONARY['drawing.properties'] })).toBeTruthy();
    });

    it('opens the reading that was pressed', () => {
        renderSlot(null, 'sma-1');

        expect(screen.getByRole('group', { name: EN_DICTIONARY['indicator.sma'] })).toBeTruthy();
    });

    it('offers what that reading is tuned by', () => {
        renderSlot(null, 'sma-1');

        expect(screen.getByDisplayValue('20')).toBeTruthy();
    });

    it('shows the mark rather than the reading, which is what was pressed last', () => {
        // A reader picks one thing at a time, and two panels arguing over the
        // same corner is a layout deciding what they meant.
        renderSlot(LEVEL, 'sma-1');

        expect(screen.queryByRole('group', { name: EN_DICTIONARY['indicator.sma'] })).toBeNull();
    });

    it('closes the reading when the reader says so', () => {
        const kernel = renderSlot(null, 'sma-1');

        act(() => { screen.getByRole('button', { name: EN_DICTIONARY['indicators.close'] }).click(); });

        expect(kernel.container.chart.store.read().pickedInstanceId).toBeNull();
    });

    it('says nothing about a copy that has since been taken off the chart', () => {
        renderSlot(null, 'ema-9');

        expect(screen.queryByRole('group')).toBeNull();
    });

    it('says nothing about a copy of something this build can no longer draw', () => {
        // A reading whose indicator has gone is still in the reader's stored
        // set, and a panel that named it would have nothing to put in it.
        const foreign = { instanceId: 'gone-1', indicatorId: 'gone', settings: {}, tone: 'amber' as const };

        renderSlot(null, 'gone-1', [foreign]);

        expect(screen.queryByRole('group')).toBeNull();
    });
});
