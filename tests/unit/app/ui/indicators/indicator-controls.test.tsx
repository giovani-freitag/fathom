import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import type { AddedIndicator } from '../../../../../src/shared/core/indicator-selection.ts';
import { IndicatorOverlay } from '../../../../../src/app/ui/indicators/indicator-controls.tsx';
import { LayerList } from '../../../../../src/app/ui/indicators/layer-list.tsx';
import { type IndicatorControls, useIndicators } from '../../../../../src/app/react/use-indicators.ts';

const EMA: AddedIndicator = {
    instanceId: 'ema-1', indicatorId: 'ema', settings: { periodBars: 50 }, tone: 'amber',
};

/**
 * The overlay, and the panel that removing now happens in.
 *
 * The chart says what a layer reads; the panel is where a reader acts on it.
 * A notice about what was just removed belongs beside the chart it left.
 */
function OverlayHarness(): ReactElement {
    const controls = useIndicators();
    return (
        <>
            <LayerList controls={controls} onOpenSettings={() => undefined} />
            <IndicatorOverlay controls={controls} />
        </>
    );
}

describe('adding twice before a render', () => {
    it('lands both, though neither call has seen the other', () => {
        // Where the bug was: the handler read the set from the render it was
        // created in, so two additions in one frame both appended to the same
        // stale list and the second landed on top of the first.
        const kernel = createIndicatorKernel();
        let controls: IndicatorControls | null = null;

        function Probe(): null {
            controls = useIndicators();
            return null;
        }

        renderWithKernel(kernel, <Probe />);
        act(() => {
            controls!.add('ema');
            controls!.add('rsi');
        });

        expect(kernel.readAdded().map((entry) => entry.indicatorId)).toEqual(['ema', 'rsi']);
    });

    it('lands three of one indicator, each as its own copy', () => {
        const kernel = createIndicatorKernel();
        let controls: IndicatorControls | null = null;

        function Probe(): null {
            controls = useIndicators();
            return null;
        }

        renderWithKernel(kernel, <Probe />);
        act(() => {
            controls!.add('rsi');
            controls!.add('rsi');
            controls!.add('rsi');
        });

        expect(kernel.readAdded().map((entry) => entry.instanceId)).toEqual(['rsi-1', 'rsi-2', 'rsi-3']);
    });
});

describe('RemovalNotice', () => {
    it('offers back what was just dismissed', () => {
        const kernel = createIndicatorKernel([EMA]);
        renderWithKernel(kernel, <OverlayHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        expect(kernel.readAdded()).toEqual([EMA]);
    });

    it('names what it is offering back, so it is not a bare button', () => {
        const kernel = createIndicatorKernel([EMA]);
        renderWithKernel(kernel, <OverlayHarness />);

        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

        expect(screen.getByText('EMA removed')).toBeDefined();
    });

    it('stops offering once the reader has moved on', () => {
        vi.useFakeTimers();
        try {
            const kernel = createIndicatorKernel([EMA]);
            renderWithKernel(kernel, <OverlayHarness />);
            fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

            act(() => { vi.advanceTimersByTime(8_000); });

            expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('will not take the book off, because a collector nobody can stop is worse', () => {
        // Hiding it leaves the same chart behind; removing it takes the control
        // that stops the recording with it.
        renderWithKernel(createIndicatorKernel([
            { instanceId: 'depth-1', indicatorId: 'depth', settings: {}, tone: 'ink' },
        ]), <OverlayHarness />);

        const remove = screen.getByRole<HTMLButtonElement>('button', { name: 'Remove' });

        expect(remove.disabled).toBe(true);
    });

    it('says nothing until something has been removed', () => {
        renderWithKernel(createIndicatorKernel([EMA]), <OverlayHarness />);

        expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    });
});

describe('taking a host layer off', () => {
    it('offers it back, the same as an indicator', () => {
        // A host layer had no way back: the notice only knew the arithmetic
        // half of the catalogue.
        const kernel = createIndicatorKernel([
            { instanceId: 'candles-1', indicatorId: 'candles', settings: {}, tone: 'ink' },
        ]);
        renderWithKernel(kernel, <OverlayHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        expect(kernel.readAdded().map((entry) => entry.indicatorId)).toEqual(['candles']);
    });
});
