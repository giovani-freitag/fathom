import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { ChartAlert } from '../../../../src/app/ui/chart-alert.tsx';
import {
    createIndicatorKernel,
    type IndicatorKernel,
    renderWithKernel,
} from '../../../mocks/indicator-kernel.tsx';
import type { TranslationKey } from '../../../../src/app/i18n/dictionaries/en.ts';

function renderAlert(failureKey: TranslationKey | null): IndicatorKernel {
    const kernel = createIndicatorKernel();
    kernel.setState((state) => ({ ...state, phase: 'ready', failureKey }));
    renderWithKernel(kernel, <ChartAlert />);
    return kernel;
}

/** What the strip is saying, or null when it is not there. */
function readAlert(): string | null {
    return screen.queryByRole('status')?.textContent ?? null;
}

describe('ChartAlert', () => {
    it('says nothing while there is nothing to say', () => {
        renderAlert(null);

        expect(readAlert()).toBeNull();
    });

    it('tells a reader what went wrong', () => {
        renderAlert('failure.refused');

        expect(readAlert()).toContain('refused');
    });

    it('lets a reader who cannot act on it put it away', () => {
        // It clears itself on the next window that loads, and a chart nobody is
        // panning may not load one — so without this it is there for good.
        renderAlert('failure.refused');

        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

        expect(readAlert()).toBeNull();
    });

    it('still speaks up when something different goes wrong', () => {
        // Putting one failure away is not agreeing to be told nothing about the
        // next, which is what a plain dismissed flag would have meant.
        const kernel = renderAlert('failure.refused');
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

        act(() => {
            kernel.setState((state) => ({ ...state, failureKey: 'failure.silent' }));
        });

        expect(readAlert()).toContain('did not answer');
    });

    it('stays away for the failure that was dismissed, when it is still that one', () => {
        const kernel = renderAlert('failure.refused');
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

        act(() => {
            kernel.setState((state) => ({ ...state, isLoadingWindow: true }));
        });

        expect(readAlert()).toBeNull();
    });
});
