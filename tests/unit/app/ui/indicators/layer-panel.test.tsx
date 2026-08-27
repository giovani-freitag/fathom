import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import {
    createIndicatorKernel,
    type IndicatorKernel,
    renderWithKernel,
} from '../../../../mocks/indicator-kernel.tsx';
import type { AddedIndicator } from '../../../../../src/shared/core/indicator-selection.ts';
import { EN_DICTIONARY } from '../../../../../src/app/i18n/dictionaries/en.ts';
import { LayerPanel } from '../../../../../src/app/ui/indicators/layer-panel.tsx';
import { useIndicators } from '../../../../../src/app/react/use-indicators.ts';

const BOOK: AddedIndicator = {
    instanceId: 'depth-1', indicatorId: 'depth', settings: {}, tone: 'ink',
};
const SMA: AddedIndicator = {
    instanceId: 'sma-1', indicatorId: 'sma', settings: { periodBars: 20 }, tone: 'phosphor',
};

function Harness(): ReactElement {
    return <LayerPanel controls={useIndicators()} />;
}

function renderPanel(added: readonly AddedIndicator[]): IndicatorKernel {
    const kernel = createIndicatorKernel(added);
    renderWithKernel(kernel, <Harness />);
    return kernel;
}

describe('LayerPanel', () => {
    it('opens onto what is on the chart', () => {
        renderPanel([SMA]);

        expect(screen.getByRole('listitem').textContent).toBe('SMA');
    });

    it('offers one way to add another', () => {
        renderPanel([SMA]);

        expect(screen.getByRole('button', { name: EN_DICTIONARY['indicators.add'] })).toBeDefined();
    });

    it('shows the catalogue in the panel rather than on top of it', () => {
        // It answers the same question the panel was already about, so it takes
        // the panel over instead of opening a second thing over it.
        renderPanel([SMA]);

        fireEvent.click(screen.getByRole('button', { name: EN_DICTIONARY['indicators.add'] }));

        expect(screen.getByRole('searchbox')).toBeDefined();
        expect(screen.queryByRole('listitem')).toBeNull();
    });

    it('adds what the reader picked and comes back to the list', () => {
        const kernel = renderPanel([]);
        fireEvent.click(screen.getByRole('button', { name: EN_DICTIONARY['indicators.add'] }));

        fireEvent.click(screen.getByRole('button', { name: /Donchian/ }));

        expect(kernel.readAdded().map((entry) => entry.indicatorId)).toEqual(['donchian']);
        expect(screen.queryByRole('searchbox')).toBeNull();
    });

    it('offers the way back out of the catalogue', () => {
        renderPanel([SMA]);
        fireEvent.click(screen.getByRole('button', { name: EN_DICTIONARY['indicators.add'] }));

        fireEvent.click(screen.getByRole('button', { name: EN_DICTIONARY['indicators.onTheChart'] }));

        expect(screen.getByRole('listitem')).toBeDefined();
    });

    it('opens one layer onto its own knobs, not a drawer of every layer', () => {
        renderPanel([SMA]);

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        expect(screen.getByRole('spinbutton', { name: 'Bars' })).toBeDefined();
    });

    it('keeps the recording controls with the book they are the instrument of', async () => {
        renderPanel([BOOK]);

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        expect(await screen.findByText(/The collector runs whether or not/)).toBeDefined();
    });

    it('offers them once, not once per layer on the chart', async () => {
        renderPanel([BOOK, SMA]);

        fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]!);

        expect(await screen.findAllByText(/The collector runs whether or not/)).toHaveLength(1);
    });

    it('retunes the copy whose knobs are open', () => {
        const kernel = renderPanel([SMA]);
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } });

        expect(kernel.readAdded()[0]?.settings['periodBars']).toBe(50);
    });

    it('carries what the book is made of, which nothing else does', () => {
        renderPanel([BOOK]);

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        expect(screen.getByRole('slider', { name: 'Intensity' })).toBeDefined();
    });
});

describe('a layer whose colours are a reading', () => {
    const VOLUME: AddedIndicator = {
        instanceId: 'volume-1', indicatorId: 'volume', settings: {}, tone: 'ink',
    };

    it('offers no colour to pick, since picking one would not be honoured', () => {
        // Volume is green because the bar rose. A swatch that changed nothing on
        // the chart is a control that lies about what it does.
        renderPanel([VOLUME]);

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        expect(screen.queryByText('Colour')).toBeNull();
    });

    it('still offers one to a layer drawn in the colour of its copy', () => {
        renderPanel([SMA]);

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        expect(screen.queryByText('Colour')).not.toBeNull();
    });
});
