import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChartHeader } from '../../../../src/app/ui/chart-header.tsx';
import type { DrawingControls } from '../../../../src/app/react/use-drawings.ts';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import type { IndicatorControls } from '../../../../src/app/react/use-indicators.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';

const INSTRUMENT = {
    instrumentSymbol: 'BTCUSDT',
    priceBucketSize: 10,
    frameIntervalMs: 1_000,
    firstFrameAtMs: 1_000,
    lastFrameAtMs: 86_400_000,
};

const DRAWINGS = {
    armedTool: null,
    selectedId: null,
    selected: null,
    canUndo: false,
    canRedo: false,
    toggleTool: () => undefined,
    disarm: () => undefined,
    restyleSelected: () => undefined,
    removeSelected: () => undefined,
    undo: () => undefined,
    redo: () => undefined,
} satisfies DrawingControls;

function renderHeader(hasRoomForPresets: boolean): void {
    const kernel = createIndicatorKernel([]);

    render(
        <KernelProvider container={kernel.container}>
            <ChartHeader
                drawings={DRAWINGS}
                indicators={{ added: [], addedCounts: new Map(), isFull: false } as unknown as IndicatorControls}
                instruments={[INSTRUMENT]}
                instrumentSymbol="BTCUSDT"
                onInstrumentSelect={() => undefined}
                settings={<button type="button">Settings</button>}
                hasRoomForPresets={hasRoomForPresets}
                time={{
                    visibleSpanMs: 900_000,
                    recordedSpanMs: 86_400_000,
                    onSpanSelect: () => undefined,
                    barIntervalMs: null,
                    effectiveIntervalMs: 5_000,
                    frameIntervalMs: 1_000,
                    onIntervalSelect: () => undefined,
                }}
            />
        </KernelProvider>,
    );
}

describe('ChartHeader', () => {
    it('lays the spans out where the bar has room for them', () => {
        renderHeader(true);

        expect(screen.getByRole('radio', { name: EN_DICTIONARY['span.1h'] })).toBeTruthy();
    });

    it('folds them into one control where it has not', () => {
        // Eight targets in a row do not fit beside everything else, and a bar
        // that wraps onto two lines has stopped being a bar.
        renderHeader(false);

        expect(screen.getByRole('combobox', { name: EN_DICTIONARY['span.label'] })).toBeTruthy();
    });

    it('lays out nothing it folded, so the same question is asked once', () => {
        renderHeader(false);

        expect(screen.queryByRole('radio', { name: EN_DICTIONARY['span.1h'] })).toBeNull();
    });

    it('keeps the bar readers pan and draw with, whichever way the spans went', () => {
        renderHeader(false);

        expect(screen.getByRole('button', { name: EN_DICTIONARY['drawing.measure'] })).toBeTruthy();
    });

    it('asks for the contract and the bar out loud, which a bar always has room for', () => {
        renderHeader(false);

        expect(screen.getByRole('combobox', { name: EN_DICTIONARY['interval.label'] })).toBeTruthy();
    });
});
