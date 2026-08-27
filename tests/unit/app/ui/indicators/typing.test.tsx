import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import type { AddedIndicator } from '../../../../../src/shared/core/indicator-selection.ts';
import { fireEvent as fire } from '@testing-library/react';
import { LayerPanel } from '../../../../../src/app/ui/indicators/layer-panel.tsx';
import { useIndicators } from '../../../../../src/app/react/use-indicators.ts';

const SMA: AddedIndicator = {
    instanceId: 'sma-1', indicatorId: 'sma', settings: { periodBars: 20 }, tone: 'phosphor',
};

function Harness(): ReactElement {
    return <LayerPanel controls={useIndicators()} />;
}

/** The panel, opened onto the one layer's knobs. */
function renderOpen() {
    const kernel = createIndicatorKernel([SMA]);
    renderWithKernel(kernel, <Harness />);
    fire.click(screen.getByRole('button', { name: 'Settings' }));
    return kernel;
}

describe('typing a period', () => {
    it('lets a reader type a figure a digit at a time', () => {
        // The field is fed by a read that clamps to the declared minimum. Run on
        // every keystroke, the first digit of 150 lands under it and is rewritten
        // under the cursor, so the rest of the number lands beside the clamp.
        const kernel = renderOpen();
        const field = screen.getByRole<HTMLInputElement>('spinbutton');

        // Typed the way a keyboard types: each digit lands on whatever the
        // field is showing, not on a value the test decided in advance.
        fireEvent.change(field, { target: { value: '' } });
        for (const digit of '150') {
            fireEvent.change(field, { target: { value: field.value + digit } });
        }

        expect(field.value).toBe('150');
        expect(kernel.readAdded()[0]?.settings['periodBars']).toBe(150);
    });

    it('shows what the indicator will actually use once the reader leaves', () => {
        // Below the declared minimum while typing is fine; left there, the field
        // has to stop claiming a figure the indicator is not going to honour.
        const kernel = renderOpen();
        const field = screen.getByRole<HTMLInputElement>('spinbutton');

        fireEvent.change(field, { target: { value: '1' } });
        fireEvent.blur(field);

        expect(field.value).toBe('2');
        expect(kernel.readAdded()[0]?.settings['periodBars']).toBe(2);
    });
});
