import { describe, expect, it } from 'vitest';
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

function Harness(): ReactElement {
    return <IndicatorLegend controls={useIndicators()} layout={LAYOUT} />;
}

function renderLegend(added: readonly AddedIndicator[]): IndicatorKernel {
    const kernel = createIndicatorKernel(added);
    renderWithKernel(kernel, <Harness />);
    return kernel;
}

describe('IndicatorLegend', () => {
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

        const rows = screen.getAllByRole('listitem');
        const tops = rows.map((row) => row.parentElement!.style.top);
        expect(tops.every((top) => top === `${44}px`)).toBe(true);
    });

    it('drops the indicator the reader dismissed and leaves its neighbour', () => {
        const kernel = renderLegend([SMA_FAST, RSI]);

        fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);

        expect(kernel.readAdded().map((entry) => entry.instanceId)).toEqual(['rsi-1']);
    });

    it('retunes the copy whose settings were opened, not its twin', () => {
        renderLegend([SMA_FAST, SMA_SLOW]);

        fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[1]!);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } });

        expect(screen.getByText('50')).toBeDefined();
        expect(screen.getByText('20')).toBeDefined();
    });

    it('recolours one copy without touching the other', () => {
        const kernel = renderLegend([SMA_FAST, SMA_SLOW]);

        fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]!);
        fireEvent.click(screen.getByRole('button', { name: 'cyan' }));

        expect(kernel.readAdded().map((entry) => entry.tone)).toEqual(['cyan', 'amber']);
    });
});
