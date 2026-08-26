import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { type ReactElement, useState } from 'react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import type { AddedIndicator } from '../../../../../src/shared/core/indicator-selection.ts';
import { EMPTY_DATASET } from '../../../../../src/app/core/chart-dataset.ts';
import type { ChartState } from '../../../../../src/app/core/chart-controller.ts';
import { LayerAccordion } from '../../../../../src/app/ui/indicators/layer-accordion.tsx';
import { useIndicators } from '../../../../../src/app/react/use-indicators.ts';

const STATE = {
    instruments: [],
    instrumentSymbol: 'BTCUSDT',
    dataset: EMPTY_DATASET,
} as unknown as ChartState;

const EMA: AddedIndicator = {
    instanceId: 'ema-1', indicatorId: 'ema', settings: { periodBars: 20 }, tone: 'amber',
};
const CANDLES: AddedIndicator = {
    instanceId: 'candles-1', indicatorId: 'candles', settings: {}, tone: 'ink',
};

function renderAccordion(added: readonly AddedIndicator[], openOn: string | null = null) {
    const kernel = createIndicatorKernel(added);

    function Harness(): ReactElement {
        const [expanded, setExpanded] = useState<string | null>(openOn);
        return (
            <LayerAccordion
                controls={useIndicators()}
                state={STATE}
                expanded={expanded}
                onExpandedChange={setExpanded}
            />
        );
    }

    renderWithKernel(kernel, <Harness />);
    return kernel;
}

describe('LayerAccordion', () => {
    it('opens straight onto the layer it was asked to open on', () => {
        // Reached from a row on the chart, which named the copy the reader was
        // pointing at. Landing on a closed list would make them find it again.
        renderAccordion([EMA], 'ema-1');

        expect(screen.getByRole('spinbutton')).toBeDefined();
    });

    it('keeps the rest closed', () => {
        renderAccordion([EMA]);

        expect(screen.queryByRole('spinbutton')).toBeNull();
    });

    it('offers nothing to open on a layer with nothing to be told', () => {
        renderAccordion([CANDLES]);

        const trigger = screen.getByRole('button', { name: /Candles/ });
        expect(trigger.hasAttribute('disabled')).toBe(true);
    });

    it('still lets a layer with no settings be hidden and dropped', () => {
        const kernel = renderAccordion([CANDLES]);

        fireEvent.click(screen.getByRole('button', { name: 'Hide' }));

        expect(kernel.readAdded()[0]?.isHidden).toBe(true);
        expect(screen.getByRole('button', { name: 'Remove' })).toBeDefined();
    });

    it('retunes the copy whose section is open', () => {
        const kernel = renderAccordion([EMA], 'ema-1');

        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } });

        expect(kernel.readAdded()[0]?.settings['periodBars']).toBe(50);
    });

    it('says so plainly when there is nothing on the chart', () => {
        renderAccordion([]);

        expect(screen.getByText('None yet')).toBeDefined();
    });

    it('carries what the book is made of, which nothing else does', () => {
        const book: AddedIndicator = {
            instanceId: 'depth-1', indicatorId: 'depth', settings: {}, tone: 'ink',
        };
        renderAccordion([book], 'depth-1');

        expect(screen.getByRole('slider', { name: 'Intensity' })).toBeDefined();
        expect(screen.getByText('Recorded so far')).toBeDefined();
    });
});
