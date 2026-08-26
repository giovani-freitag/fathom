import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { type ReactElement, useState } from 'react';
import { createIndicatorKernel, renderWithKernel } from '../../../mocks/indicator-kernel.tsx';
import type { AddedIndicator } from '../../../../src/shared/core/indicator-selection.ts';
import type { ChartState } from '../../../../src/app/core/chart-controller.ts';
import { EMPTY_DATASET } from '../../../../src/app/core/chart-dataset.ts';
import { SettingsDrawer } from '../../../../src/app/ui/settings-drawer.tsx';
import { useIndicators } from '../../../../src/app/react/use-indicators.ts';

const STATE = {
    instruments: [],
    instrumentSymbol: 'BTCUSDT',
    dataset: EMPTY_DATASET,
} as unknown as ChartState;

const BOOK: AddedIndicator = {
    instanceId: 'depth-1', indicatorId: 'depth', settings: {}, tone: 'ink',
};
const CANDLES: AddedIndicator = {
    instanceId: 'candles-1', indicatorId: 'candles', settings: {}, tone: 'ink',
};

function renderDrawer(added: readonly AddedIndicator[], openOn: string | null = null): void {
    const kernel = createIndicatorKernel(added);

    function Harness(): ReactElement {
        const [expanded, setExpanded] = useState<string | null>(openOn);
        return (
            <SettingsDrawer
                state={STATE}
                controls={useIndicators()}
                isOpen
                onOpenChange={() => undefined}
                expandedLayer={expanded}
                onExpandedLayerChange={setExpanded}
            />
        );
    }

    renderWithKernel(kernel, <Harness />);
}

describe('SettingsDrawer', () => {
    it('keeps the recording controls with the book they are the instrument of', async () => {
        renderDrawer([BOOK, CANDLES], 'depth-1');

        expect(await screen.findByRole('slider', { name: 'Storage ceiling' })).toBeDefined();
        expect(screen.getByText(/The collector runs whether or not/)).toBeDefined();
    });

    it('offers them once, not once per layer on the chart', async () => {
        renderDrawer([BOOK, CANDLES], 'depth-1');

        expect(await screen.findAllByRole('slider', { name: 'Storage ceiling' })).toHaveLength(1);
    });

    it('never lets the book be taken away, because the collector would go with it', () => {
        // A control that disappears with its layer is a collector nobody can
        // stop, and an order book that stopped being recorded cannot be
        // recovered afterwards. It is hidden instead, which leaves the same
        // chart behind.
        renderDrawer([BOOK, CANDLES]);

        expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Hide' })).toHaveLength(2);
    });

    it('lists what is on the chart', () => {
        renderDrawer([BOOK, CANDLES]);

        expect(screen.getByRole('button', { name: /Book/ })).toBeDefined();
        expect(screen.getByRole('button', { name: /Candles/ })).toBeDefined();
    });
});
