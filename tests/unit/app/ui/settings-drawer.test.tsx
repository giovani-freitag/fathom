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

function renderDrawer(added: readonly AddedIndicator[]): void {
    const kernel = createIndicatorKernel(added);

    function Harness(): ReactElement {
        const [expanded, setExpanded] = useState<string | null>(null);
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
    it('keeps the recording controls when the book is not being drawn', async () => {
        // Kept inside the book's own section, taking the book off the chart took
        // the only control over a collector that goes on writing to disk. An
        // order book that stopped being recorded cannot be recovered afterwards.
        renderDrawer([CANDLES]);

        expect(await screen.findByRole('slider', { name: 'Storage ceiling' })).toBeDefined();
    });

    it('offers them once, not once per layer on the chart', async () => {
        renderDrawer([BOOK, CANDLES]);

        expect(await screen.findAllByRole('slider', { name: 'Storage ceiling' })).toHaveLength(1);
    });

    it('says plainly whose the recording is', () => {
        renderDrawer([CANDLES]);

        expect(screen.getByText(/Recording belongs to the machine/)).toBeDefined();
    });

    it('lists what is on the chart', () => {
        renderDrawer([BOOK, CANDLES]);

        expect(screen.getByRole('button', { name: /Book/ })).toBeDefined();
        expect(screen.getByRole('button', { name: /Candles/ })).toBeDefined();
    });
});
