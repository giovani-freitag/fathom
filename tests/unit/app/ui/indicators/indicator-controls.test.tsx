import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import { createIndicatorKernel, renderWithKernel } from '../../../../mocks/indicator-kernel.tsx';
import type { AddedIndicator } from '../../../../../src/shared/core/indicator-selection.ts';
import { IndicatorOverlay, IndicatorTrigger } from '../../../../../src/app/ui/indicators/indicator-controls.tsx';
import { EMPTY_LAYOUT } from '../../../../../src/app/painting/chart-layout.ts';
import { useIndicators } from '../../../../../src/app/react/use-indicators.ts';

const EMA: AddedIndicator = {
    instanceId: 'ema-1', indicatorId: 'ema', settings: { periodBars: 50 }, tone: 'amber',
};

function TriggerHarness(): ReactElement {
    return <IndicatorTrigger controls={useIndicators()} />;
}

function OverlayHarness(): ReactElement {
    return <IndicatorOverlay controls={useIndicators()} layout={EMPTY_LAYOUT} />;
}

describe('IndicatorTrigger', () => {
    it('opens the catalogue on the chord a reader expects a palette to answer', () => {
        renderWithKernel(createIndicatorKernel(), <TriggerHarness />);

        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

        expect(screen.getByRole('searchbox')).toBeDefined();
    });

    it('names the shortcut where a reader would look for it', () => {
        renderWithKernel(createIndicatorKernel(), <TriggerHarness />);

        const trigger = screen.getByRole('button', { name: 'Indicators' });

        expect(trigger.getAttribute('title')).toMatch(/Indicators · (⌘K|Ctrl K)/);
    });

    it('adds what the reader picked out of the catalogue', () => {
        const kernel = createIndicatorKernel();
        renderWithKernel(kernel, <TriggerHarness />);
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

        fireEvent.click(screen.getByRole('button', { name: /Donchian/ }));

        expect(kernel.readAdded().map((entry) => entry.indicatorId)).toEqual(['donchian']);
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

    it('says nothing until something has been removed', () => {
        renderWithKernel(createIndicatorKernel([EMA]), <OverlayHarness />);

        expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    });
});
