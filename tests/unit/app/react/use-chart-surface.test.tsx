import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { ChartSurface } from '../../../../src/app/ui/chart-surface.tsx';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';
import { ObservableStore } from '../../../../src/app/core/observable-store.ts';
import type { ServiceContainer } from '../../../../src/app/core/service-container.ts';

describe('useChartSurface', () => {
    let chartStore: ObservableStore<never>;
    let appearanceStore: ObservableStore<never>;
    let drawingsStore: ObservableStore<never>;
    let applyView: ReturnType<typeof vi.fn>;
    let chartSubscribers: number;
    let appearanceSubscribers: number;

    /** A store that reports how many listeners are attached to it right now. */
    function countingStore<TState>(
        initialState: TState,
        note: (delta: number) => void,
    ): ObservableStore<TState> {
        const store = new ObservableStore<TState>({ initialState });
        const subscribe = store.subscribe.bind(store);
        store.subscribe = (listener) => {
            note(1);
            const release = subscribe(listener);
            return () => { note(-1); release(); };
        };
        return store;
    }

    function renderSurface(): ReturnType<typeof render> {
        const container = {
            chart: { store: chartStore, applyView },
            appearance: { store: appearanceStore },
            drawings: { store: drawingsStore },
        } as unknown as ServiceContainer;

        return render(
            <KernelProvider container={container}>
                <ChartSurface />
            </KernelProvider>,
        );
    }

    beforeEach(() => {
        chartSubscribers = 0;
        appearanceSubscribers = 0;
        applyView = vi.fn();
        chartStore = countingStore({
            revision: 0,
            viewport: { fromMs: 0, toMs: 1_000, lowPrice: 0, highPrice: 1 },
            dataset: { frames: [], clusters: [], gaps: [] },
            isVolumeProfileVisible: false,
            // The surface measures its panes before it paints, to say how many
            // price rows it has room for.
            plans: [],
        } as never, (delta) => { chartSubscribers += delta; });
        appearanceStore = countingStore(
            { locale: 'en', resolvedTheme: 'dark' } as never,
            (delta) => { appearanceSubscribers += delta; },
        );
        drawingsStore = new ObservableStore<never>({
            initialState: { armedTool: null, drawings: [], selectedId: null, draft: null } as never,
        });
    });

    it('follows the appearance as well as the chart, so a theme change repaints', () => {
        // The canvas cannot inherit a theme the way the cascade does. Without
        // this subscription a switch leaves the field in the old palette until
        // something else happens to move the chart.
        renderSurface();

        expect(chartSubscribers).toBeGreaterThanOrEqual(1);
        expect(appearanceSubscribers).toBeGreaterThanOrEqual(1);
    });

    it('lets go of both when the surface is unmounted, leaving no listener behind', () => {
        const view = renderSurface();

        view.unmount();

        expect(chartSubscribers).toBe(0);
        expect(appearanceSubscribers).toBe(0);
    });

    it('tells the chart how wide the surface it has to fill is', () => {
        renderSurface();

        act(() => undefined);

        expect(applyView).toHaveBeenCalledWith(expect.objectContaining({ surfaceWidthPx: 1_000 }));
    });
});
