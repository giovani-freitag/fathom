import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import {
    createIndicatorKernel,
    type IndicatorKernel,
    renderWithKernel,
} from '../../../../mocks/indicator-kernel.tsx';
import type { AddedIndicator } from '../../../../../src/shared/core/indicator-selection.ts';
import { LayerList } from '../../../../../src/app/ui/indicators/layer-list.tsx';
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
const BOOK: AddedIndicator = {
    instanceId: 'depth-1', indicatorId: 'depth', settings: {}, tone: 'ink',
};
const RSI: AddedIndicator = {
    instanceId: 'rsi-1', indicatorId: 'rsi', settings: { periodBars: 14 }, tone: 'violet',
};

const onOpenSettings = vi.fn<(instanceId: string) => void>();

function Harness(): ReactElement {
    return <LayerList controls={useIndicators()} onOpenSettings={onOpenSettings} />;
}

function renderList(added: readonly AddedIndicator[]): IndicatorKernel {
    const kernel = createIndicatorKernel(added);
    renderWithKernel(kernel, <Harness />);
    return kernel;
}

/** Every control of one kind, in the order the layers are listed. */
function controls(name: string): HTMLButtonElement[] {
    return screen.getAllByRole<HTMLButtonElement>('button', { name });
}

describe('LayerList', () => {
    beforeEach(() => { onOpenSettings.mockClear(); });

    it('shows nothing at all for a chart with no layers on it', () => {
        renderList([]);

        expect(screen.queryByRole('list')).toBeNull();
    });

    it('lists what is on the chart, by name', () => {
        renderList([SMA_FAST, RSI]);

        expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('gives every layer the same controls, at the same size', () => {
        // The four actions used to be repeated along the rows over the chart, at
        // a size of their own, over the very data they were about.
        renderList([SMA_FAST, RSI]);

        expect(controls('Hide')).toHaveLength(2);
    });

    it('hides the layer whose eye was pressed', () => {
        const kernel = renderList([SMA_FAST, RSI]);

        fireEvent.click(controls('Hide')[1]!);

        expect(kernel.readAdded()[1]?.isHidden).toBe(true);
    });

    it('keeps a hidden layer listed, with the control that brings it back', () => {
        // Hiding is not removing: the parameters survive, and the way back has
        // to be here rather than in the catalogue.
        const kernel = renderList([SMA_FAST, { ...RSI, isHidden: true }]);

        fireEvent.click(screen.getByRole('button', { name: 'Show' }));

        expect(kernel.readAdded()[1]?.isHidden).toBe(false);
    });

    it('drops the layer the reader dismissed and leaves its neighbour', () => {
        const kernel = renderList([SMA_FAST, RSI]);

        fireEvent.click(controls('Remove')[0]!);

        expect(kernel.readAdded().map((entry) => entry.instanceId)).toEqual(['rsi-1']);
    });

    it('sends tuning somewhere with room for it, naming the copy that asked', () => {
        renderList([SMA_FAST, SMA_SLOW]);

        fireEvent.click(controls('Settings')[1]!);

        expect(onOpenSettings).toHaveBeenCalledWith('sma-2');
    });

    it('offers a way into the knobs a host layer declares', () => {
        renderList([CANDLES]);

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Settings' }).disabled).toBe(false);
    });

    it('will not take the book off, because a collector nobody can stop is worse', () => {
        // Hiding it leaves the same chart behind; removing it takes the control
        // that stops the recording with it.
        renderList([BOOK]);

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove' }).disabled).toBe(true);
    });

    it('still lets the book be hidden, which leaves the same chart behind', () => {
        renderList([BOOK]);

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Hide' }).disabled).toBe(false);
    });
});
