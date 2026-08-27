import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import {
    BAR_INSTANTS,
    createIndicatorKernel,
    type IndicatorKernel,
    renderWithKernel,
} from '../../../../mocks/indicator-kernel.tsx';
import type { AddedIndicator } from '../../../../../src/shared/core/indicator-selection.ts';
import { IndicatorLegend } from '../../../../../src/app/ui/indicators/indicator-legend.tsx';
import { resolveChartLayout } from '../../../../../src/app/painting/chart-layout.ts';
import { useIndicators } from '../../../../../src/app/react/use-indicators.ts';

const SMA_FAST: AddedIndicator = {
    instanceId: 'sma-1', indicatorId: 'sma', settings: { periodBars: 20 }, tone: 'phosphor',
};
const SMA_SLOW: AddedIndicator = {
    instanceId: 'sma-2', indicatorId: 'sma', settings: { periodBars: 200 }, tone: 'amber',
};
const RSI: AddedIndicator = {
    instanceId: 'rsi-1', indicatorId: 'rsi', settings: { periodBars: 14 }, tone: 'violet',
};

const LAYOUT = resolveChartLayout({
    cssWidth: 1_200,
    cssHeight: 800,
    isVolumeProfileVisible: false,
    indicatorPaneCount: 1,
});

const onOpenSettings = vi.fn<(instanceId: string) => void>();

function Harness(): ReactElement {
    return <IndicatorLegend controls={useIndicators()} layout={LAYOUT} onOpenSettings={onOpenSettings} />;
}

function renderLegend(added: readonly AddedIndicator[]): IndicatorKernel {
    const kernel = createIndicatorKernel(added);
    renderWithKernel(kernel, <Harness />);
    return kernel;
}

describe('IndicatorLegend', () => {
    beforeEach(() => { onOpenSettings.mockClear(); });

    it('tells two copies of one indicator apart by what the reader chose', () => {
        // Same name, same shape on the chart. Without the parameters and the
        // colour there is nothing on screen that says which line is which.
        renderLegend([SMA_FAST, SMA_SLOW]);

        expect(screen.getByText('20')).toBeDefined();
        expect(screen.getByText('200')).toBeDefined();
    });

    it('puts a paned indicator at the top of its own band, not with the rest', () => {
        renderLegend([SMA_FAST, RSI]);

        const rows = screen.getAllByRole('listitem');
        const paneTop = LAYOUT.indicatorPanes[0]!.topY;
        const tops = rows.map((row) => row.parentElement!.style.top);
        expect(tops.some((top) => top === `${paneTop + 3}px`)).toBe(true);
    });

    it('reads what each series carried where the pointer is', () => {
        const kernel = renderLegend([RSI]);

        kernel.moveCursorTo(BAR_INSTANTS[250]!);

        // Bounded to nought and a hundred, so any real reading is two digits
        // with two decimals rather than a price.
        expect(screen.getByText(/^\d{1,3}\.\d{2}$/)).toBeDefined();
    });

    it('keeps reading the newest bar once the pointer leaves the chart', () => {
        // A row that empties as the pointer leaves changes width under the hand
        // reaching for its controls, and the click lands somewhere else.
        const kernel = renderLegend([RSI]);
        kernel.moveCursorTo(BAR_INSTANTS.at(-1)!);
        const atNewestBar = screen.getByText(/^\d{1,3}\.\d{2}$/).textContent;

        kernel.moveCursorTo(null);

        expect(screen.getByText(/^\d{1,3}\.\d{2}$/).textContent).toBe(atNewestBar);
    });

    it('names a hidden indicator nowhere, because it reads nothing there', () => {
        // Bringing it back is one panel away; a row over the chart for a layer
        // that is not drawn is chart nobody can see.
        renderLegend([{ ...RSI, isHidden: true }]);

        expect(screen.queryAllByRole('listitem')).toEqual([]);
    });

    it('names a layer with nothing to read nowhere either', () => {
        renderLegend([{ instanceId: 'depth-1', indicatorId: 'depth', settings: {}, tone: 'ink' }]);

        expect(screen.queryAllByRole('listitem')).toEqual([]);
    });

    it('still names one that does read something', () => {
        renderLegend([SMA_FAST]);

        expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });

});

describe('IndicatorLegend folded away', () => {
    it('says how many are on the chart without listing them', () => {
        // A run of rows whose widths follow whatever each has to say is a ragged
        // edge over the chart, and the chart is the thing being read. Counted
        // are the ones over the price: an oscillator has a band of its own.
        renderLegend([SMA_FAST, SMA_SLOW, RSI]);

        const fold = screen.getByRole('button', { name: 'Fold the rows away' });

        expect(fold.textContent).toContain('2');
        expect(fold.getAttribute('aria-expanded')).toBe('true');
    });

    it('hides the rows once it is folded, and keeps counting them', () => {
        const kernel = renderLegend([SMA_FAST, SMA_SLOW]);

        fireEvent.click(screen.getByRole('button', { name: 'Fold the rows away' }));

        expect(kernel.container.appearance.store.read().isLegendCollapsed).toBe(true);
    });

    it('offers nothing to fold when there is one row to fold away', () => {
        // Folding one row saves a line and costs one. The control is offered
        // once there is more than that to put away.
        renderLegend([SMA_FAST]);

        expect(screen.queryByRole('button', { name: 'Fold the rows away' })).toBeNull();
    });

    it('counts only the rows it actually drew', () => {
        // A layer that reads nothing takes no row, so counting it left the
        // control claiming to hide more than there was.
        renderLegend([
            SMA_FAST,
            SMA_SLOW,
            { instanceId: 'depth-1', indicatorId: 'depth', settings: {}, tone: 'ink' },
        ]);

        expect(screen.getByRole('button', { name: 'Fold the rows away' }).textContent).toContain('2');
    });
});
