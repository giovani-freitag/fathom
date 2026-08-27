import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { ChartController } from '../../../../src/app/core/chart-controller.ts';
import { type ChartServiceMocks, createChartServiceMocks } from '../../../mocks/chart-services.ts';
import { createCursorStore } from '../../../../src/app/core/cursor-store.ts';
import { HeatmapPage } from '../../../../src/app/ui/heatmap-page.tsx';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';
import type { ServiceContainer } from '../../../../src/app/core/service-container.ts';

const APPEARANCE = { locale: 'en', themeChoice: 'system', resolvedTheme: 'dark' } as const;

interface MountedPage {
    readonly chart: ChartController;
    readonly mocks: ChartServiceMocks;
    readonly container: HTMLElement;
}

function mountPage(): MountedPage {
    const mocks = createChartServiceMocks();
    const chart = new ChartController({
        api: mocks.api,
        liveFeed: mocks.liveFeed,
        preferences: mocks.preferences,
    });
    const kernel = {
        api: mocks.api,
        liveFeed: mocks.liveFeed,
        preferences: mocks.preferences,
        chart,
        cursor: createCursorStore(),
        recording: null,
        appearance: {
            store: { read: () => APPEARANCE, subscribe: () => () => undefined },
            selectLocale: () => undefined,
            selectTheme: () => undefined,
        },
    } as unknown as ServiceContainer;

    const { container } = render(
        <StrictMode>
            <KernelProvider container={kernel}><HeatmapPage /></KernelProvider>
        </StrictMode>,
    );
    return { chart, mocks, container };
}

describe('HeatmapPage', () => {
    it('loads the window even though the mount runs its effects twice', async () => {
        // The container outlives the page, so a page that tore the chart down on
        // unmount left a dead controller for the next mount to draw nothing from
        // — which is every mount, under a tree that double-invokes its effects.
        const { chart, mocks } = mountPage();

        await vi.waitFor(() => { expect(mocks.fetchPriceBars).toHaveBeenCalled(); });

        chart.dispose();
    });

    it('offers the way back where the chart left the live edge, not in the header', async () => {
        // A reader who has panned into history is looking at the chart, and the
        // drag that took them there has no obvious undo. The control belongs
        // where their eye already is.
        const { chart, container } = mountPage();
        await chart.initialize();

        act(() => {
            chart.applyView({
                viewport: { ...chart.store.read().viewport, fromMs: 1_000, toMs: 900_000 },
                surfaceWidthPx: 800,
                isFollowingLive: false,
            });
        });

        const back = await screen.findByLabelText('Back to live');
        expect(container.querySelector('header')?.contains(back)).toBe(false);
        chart.dispose();
    });

    it('keeps it off the chart while the chart is already live', async () => {
        const { chart } = mountPage();

        await chart.initialize();

        expect(screen.queryByLabelText('Back to live')).toBeNull();
        chart.dispose();
    });
});
