import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { ChartController } from '../../../../src/app/core/chart-controller.ts';
import { createChartServiceMocks } from '../../../mocks/chart-services.ts';
import { createCursorStore } from '../../../../src/app/core/cursor-store.ts';
import { HeatmapPage } from '../../../../src/app/ui/heatmap-page.tsx';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';
import type { ServiceContainer } from '../../../../src/app/core/service-container.ts';

const APPEARANCE = { locale: 'en', themeChoice: 'system', resolvedTheme: 'dark' } as const;

describe('HeatmapPage', () => {
    it('loads the window even though the mount runs its effects twice', async () => {
        // The container outlives the page, so a page that tore the chart down on
        // unmount left a dead controller for the next mount to draw nothing from
        // — which is every mount, under a tree that double-invokes its effects.
        const mocks = createChartServiceMocks();
        const chart = new ChartController({
            api: mocks.api,
            liveFeed: mocks.liveFeed,
            preferences: mocks.preferences,
        });
        const container = {
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

        render(
            <StrictMode>
                <KernelProvider container={container}><HeatmapPage /></KernelProvider>
            </StrictMode>,
        );

        await vi.waitFor(() => { expect(mocks.fetchPriceBars).toHaveBeenCalled(); });
        chart.dispose();
    });
});
