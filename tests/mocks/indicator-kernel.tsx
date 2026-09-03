import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { type AddedIndicator, resolveBandKey } from '../../src/shared/core/indicator-selection.ts';
import type { AppearanceState } from '../../src/app/core/appearance-controller.ts';
import type { ChartState } from '../../src/app/core/chart-controller.ts';
import { createCursorStore } from '../../src/app/core/cursor-store.ts';
import type { DrawPlan } from '../../src/shared/core/draw-plan.ts';
import { EMPTY_DATASET } from '../../src/app/core/chart-dataset.ts';
import { findIndicator } from '../../src/app/indicators/indicator-catalogue.ts';
import { KernelProvider } from '../../src/app/react/kernel-provider.tsx';
import { ObservableStore } from '../../src/app/core/observable-store.ts';
import { completePlan, recolourPlan } from '../../src/shared/core/draw-plan.ts';
import type { ServiceContainer } from '../../src/app/core/service-container.ts';
import { buildRun, buildWindow } from './price-bars.ts';

// The real shape rather than a copy of it: a copy drifts the moment the
// interface gains a preference, and a mock that drifts renders the control the
// application does not.
const APPEARANCE: AppearanceState = {
    locale: 'en',
    themeChoice: 'system',
    resolvedTheme: 'dark',
    isLegendCollapsed: false,
    gridChoice: 'price',
};

/** Enough bars that every shipped indicator has something to say. */
const BARS = buildWindow(buildRun(300, (index) => 100 + Math.sin(index / 8) * 12));

export interface IndicatorKernel {
    readonly container: ServiceContainer;
    readonly readAdded: () => readonly AddedIndicator[];
    readonly moveCursorTo: (atMs: number | null) => void;
    /** Puts the chart in a state a test wants the interface to react to. */
    readonly setState: (revise: (state: ChartState) => ChartState) => void;
}

/**
 * A kernel that runs the real indicators over synthetic bars.
 *
 * The revision is applied for real rather than recorded, so a test asserts on
 * what the interface ends up showing instead of on which function it called.
 *
 * @param added - What the chart starts with.
 * @returns The container, and the two things a test needs to drive it.
 */
export function createIndicatorKernel(added: readonly AddedIndicator[] = []): IndicatorKernel {
    const cursor = createCursorStore();
    const appearance = new ObservableStore<AppearanceState>({ initialState: APPEARANCE });
    const store = new ObservableStore<ChartState>({
        initialState: buildState(added),
    });

    const container = {
        cursor,
        recording: {
            listContracts: () => Promise.resolve([]),
            readBudget: () => Promise.resolve({ maximumBytes: 10_737_418_240, usedBytes: 0, availableBytes: null }),
            saveContract: () => Promise.resolve(),
            setBudget: () => Promise.resolve(),
            pruneToBudget: () => Promise.resolve(0),
        },
        // A real store, not a frozen answer: what the interface does with a
        // look preference is only visible if setting one changes what it reads.
        appearance: {
            store: appearance,
            selectLocale: () => undefined,
            selectTheme: () => undefined,
            setLegendCollapsed: (isLegendCollapsed: boolean) => {
                appearance.update((state) => ({ ...state, isLegendCollapsed }));
            },
        },
        chart: {
            store,
            refreshInstruments: () => Promise.resolve(),
            updateIndicators: (revise: (current: readonly AddedIndicator[]) => readonly AddedIndicator[]) => {
                store.update((state) => buildState(revise(state.addedIndicators)));
            },
            pickLayer: (instanceId: string | null) => {
                store.update((state) => ({ ...state, pickedInstanceId: instanceId }));
            },
        },
    } as unknown as ServiceContainer;

    return {
        container,
        readAdded: () => store.read().addedIndicators,
        moveCursorTo: (atMs) => { cursor.update(() => ({ atMs })); },
        setState: (revise) => { store.update(revise); },
    };
}

/**
 * Renders a component under a kernel, the way the application mounts it.
 *
 * @param kernel - The kernel to provide.
 * @param element - What to render.
 */
export function renderWithKernel(kernel: IndicatorKernel, element: ReactElement): RenderResult {
    return render(<KernelProvider container={kernel.container}>{element}</KernelProvider>);
}

/** The instants the synthetic bars close at, for a test that moves the cursor. */
export const BAR_INSTANTS = BARS.bars.map((bar) => bar.closedAtMs);

function buildState(added: readonly AddedIndicator[]): ChartState {
    return {
        addedIndicators: added,
        plans: added.flatMap(toPlan),
        dataset: { ...EMPTY_DATASET, bars: BARS },
        instruments: [],
        instrumentSymbol: 'BTCUSDT',
        isVolumeProfileVisible: false,
        pickedInstanceId: null,
    } as unknown as ChartState;
}

function toPlan(entry: AddedIndicator): DrawPlan[] {
    const indicator = findIndicator(entry.indicatorId);
    // Mirrors the controller: a hidden indicator produces nothing, so it takes
    // no band and no arithmetic.
    if (indicator === null || entry.isHidden === true) {
        return [];
    }
    const plan = completePlan(
        { indicatorId: entry.indicatorId, indicator, settings: entry.settings, warmupBarCount: 300 },
        indicator.compute({ bars: BARS, sessions: {}, settings: entry.settings }),
    );
    return [{
        ...recolourPlan(plan, entry.tone),
        instanceId: entry.instanceId,
        bandKey: resolveBandKey(entry),
    }];
}
