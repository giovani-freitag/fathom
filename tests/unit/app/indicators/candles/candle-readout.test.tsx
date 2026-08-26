import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildBar, buildWindow } from '../../../../mocks/price-bars.ts';
import { CandleReadout } from '../../../../../src/app/indicators/candles/candle-readout.tsx';
import type { ChartState } from '../../../../../src/app/core/chart-controller.ts';
import { createIndicatorKernel } from '../../../../mocks/indicator-kernel.tsx';
import { EMPTY_DATASET } from '../../../../../src/app/core/chart-dataset.ts';
import { KernelProvider } from '../../../../../src/app/react/kernel-provider.tsx';
import type { PriceBar } from '../../../../../src/shared/core/price-bar.ts';

const FIRST = buildBar(1_000_000, 105, { openPrice: 100, highPrice: 110, lowPrice: 95 });
const NEWEST = buildBar(1_060_000, 99.5, { openPrice: 100, highPrice: 101, lowPrice: 99 });

function renderReadout(bars: readonly PriceBar[]): HTMLElement {
    const kernel = createIndicatorKernel([]);
    const store = kernel.container.chart.store;
    store.update((state: ChartState) => ({
        ...state,
        dataset: { ...EMPTY_DATASET, bars: buildWindow([...bars]) },
    }));

    const { container } = render(
        <KernelProvider container={kernel.container}>
            <CandleReadout />
        </KernelProvider>,
    );
    return container;
}

describe('CandleReadout', () => {
    it('reads the newest bar while the pointer is off the chart', () => {
        // What a reader means by "now". A row that went blank the moment the
        // pointer left would be empty almost always.
        renderReadout([FIRST, NEWEST]);

        expect(screen.getByText('99.5')).toBeTruthy();
        expect(screen.getByText('101')).toBeTruthy();
    });

    it('says how far the bar moved from its own open', () => {
        // Against its own open, which is what the bar's colour is claiming.
        renderReadout([FIRST, NEWEST]);

        expect(screen.getByText('-0.5')).toBeTruthy();
        expect(screen.getByText('(-0.50%)')).toBeTruthy();
    });

    it('says nothing at all when no bar has been loaded', () => {
        const container = renderReadout([]);

        expect(container.textContent).toBe('');
    });
});
