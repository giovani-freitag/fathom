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
const CANDLES: AddedIndicator = {
    instanceId: 'candles-1', indicatorId: 'candles', settings: {}, tone: 'ink',
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

    it('keeps a hidden indicator listed, with the control that brings it back', () => {
        // Hiding is not removing: the parameters survive, and the way back has
        // to be on the row rather than in the catalogue.
        const hidden = { ...RSI, isHidden: true };
        const kernel = renderLegend([SMA_FAST, hidden]);

        expect(screen.getByRole('button', { name: 'Show' })).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'Show' }));
        expect(kernel.readAdded()[1]?.isHidden).toBe(false);
    });

    it('gives a hidden indicator no band, so it stops taking room from the price', () => {
        renderLegend([{ ...RSI, isHidden: true }]);

        // Every row at the same height is the rule itself: nothing was given a
        // band of its own, so nothing took height from the price.
        const rows = screen.getAllByRole('listitem');
        const tops = new Set(rows.map((row) => row.parentElement!.style.top));

        expect(tops.size).toBe(1);
    });

    it('drops the indicator the reader dismissed and leaves its neighbour', () => {
        const kernel = renderLegend([SMA_FAST, RSI]);

        fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);

        expect(kernel.readAdded().map((entry) => entry.instanceId)).toEqual(['rsi-1']);
    });

    it('sends tuning somewhere with room for it, naming the copy that asked', () => {
        renderLegend([SMA_FAST, SMA_SLOW]);

        fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[1]!);

        expect(onOpenSettings).toHaveBeenCalledWith('sma-2');
    });

    it('offers a way into the knobs a host layer declares', () => {
        renderLegend([CANDLES]);

        expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'Remove' })).toBeDefined();
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
        const kernel = renderLegend([SMA_FAST, RSI]);

        fireEvent.click(screen.getByRole('button', { name: 'Fold the rows away' }));

        expect(kernel.container.appearance.store.read().isLegendCollapsed).toBe(true);
    });
});
