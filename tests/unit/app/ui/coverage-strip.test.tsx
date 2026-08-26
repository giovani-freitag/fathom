import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChartState } from '../../../../src/app/core/chart-controller.ts';
import { CoverageStrip } from '../../../../src/app/ui/coverage-strip.tsx';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { EMPTY_DATASET } from '../../../../src/app/core/chart-dataset.ts';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';

function buildState(isDepthVisible: boolean): ChartState {
    return {
        isDepthVisible,
        isFollowingLive: true,
        liveStatus: 'streaming',
        isLoadingWindow: false,
        failureKey: null,
        phase: 'ready',
        dataset: { ...EMPTY_DATASET, sampleIntervalMs: 1_000, bars: { ...EMPTY_DATASET.bars, intervalMs: 5_000 } },
    } as unknown as ChartState;
}

function renderStrip(isDepthVisible: boolean): void {
    const kernel = createIndicatorKernel([]);
    render(
        <KernelProvider container={kernel.container}>
            <CoverageStrip state={buildState(isDepthVisible)} />
        </KernelProvider>,
    );
}

describe('CoverageStrip', () => {
    it('says how wide a column of the book is while the book is drawn', () => {
        renderStrip(true);

        expect(screen.getByText(/\/col$/)).toBeTruthy();
    });

    it('says nothing about columns on a chart that draws no book', () => {
        // A chart of candles alone has no column of book to measure, and the
        // width it would report is nought rather than an answer.
        renderStrip(false);

        expect(screen.queryByText(/\/col$/)).toBeNull();
    });
});
