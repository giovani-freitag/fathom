import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { AddedIndicator } from '../../src/shared/core/indicator-selection.ts';
import type { AppearanceState } from '../../src/app/core/appearance-controller.ts';
import { AddonLibraryService } from '../../src/app/services/addon-library/addon-library-service.ts';
import { type ChartState, computePlanSet } from '../../src/app/core/chart-controller.ts';
import { createCursorStore } from '../../src/app/core/cursor-store.ts';
import type { DrawPlan } from '../../src/shared/core/draw-plan.ts';
import { EMPTY_DATASET } from '../../src/app/core/chart-dataset.ts';
import { KernelProvider } from '../../src/app/react/kernel-provider.tsx';
import { ObservableStore } from '../../src/app/core/observable-store.ts';
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

let shelfClock = 0;

/** Storage each kernel owns, so one test's readings never reach another. */
function buildShelf(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    // Keyed, because the shelf and the draft are two of them: one slot handed
    // the draft back whenever the shelf was read.
    const held = new Map<string, string>();
    return {
        getItem: (key) => held.get(key) ?? null,
        setItem: (key, value) => { held.set(key, value); },
        removeItem: (key) => { held.delete(key); },
    };
}

/** Enough bars that every shipped indicator has something to say. */
const BARS = buildWindow(buildRun(300, (index) => 100 + Math.sin(index / 8) * 12));

export interface IndicatorKernel {
    readonly container: ServiceContainer;
    readonly readAdded: () => readonly AddedIndicator[];
    /** The plans the chart currently holds, as the painters would be given them. */
    readonly readPlans: () => readonly DrawPlan[];
    /** Why a reading drew nothing, by the copy it belongs to. */
    readonly readFailures: () => Readonly<Record<string, string>>;
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
        // The real service over storage a test owns, so what a reading is filed
        // under is decided by the code the application runs.
        addons: new AddonLibraryService({ storage: buildShelf(), now: () => (shelfClock += 1) }),
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
        readPlans: () => store.read().plans,
        readFailures: () => store.read().layerFailures,
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
    const bare = {
        addedIndicators: added,
        plans: [],
        layerFailures: {},
        dataset: { ...EMPTY_DATASET, bars: BARS },
        instruments: [],
        instrumentSymbol: 'BTCUSDT',
        isVolumeProfileVisible: false,
        pickedInstanceId: null,
    } as unknown as ChartState;

    // The chart's own arithmetic, not a copy of it: a mock that computes plans
    // its own way renders a chart the application never draws.
    return { ...bare, ...computePlanSet(bare) };
}
