import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { ADDON_ID_PREFIX, forgetAddon } from '../../../../src/app/addons/addon-registry.ts';
import { buildAddon } from '../../../../src/app/addons/addon-runtime.ts';
import { ENTRY_FILE } from '../../../../src/shared/core/reading-files.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';
import { readLayerDefaults } from '../../../../src/app/indicators/indicator-catalogue.ts';
import { registerAddon } from '../../../../src/app/addons/addon-registry.ts';
import { useKernel } from '../../../../src/app/react/kernel-context.ts';
import { withIndicatorAdded } from '../../../../src/shared/core/indicator-selection.ts';

const DRAFT_ID = `${ADDON_ID_PREFIX}draft`;

/** A reading whose label says which edit produced it. */
function sourceNamed(label: string): string {
    return `
        const fathom = require('fathom');
        exports.default = {
            label: ${JSON.stringify(label)},
            parameters: [],
            compute: (input) => fathom.Plot.over(input.bars)
                .line(input.bars.bars.map((bar) => bar.closePrice), ${JSON.stringify(label)})
                .overThePrice(),
        };
    `;
}

/**
 * What the editor's change handler does once a script has compiled.
 *
 * Lifted out of the hook so it can be driven without a browser: the hook adds
 * the editor, the debounce and the compiler, none of which decide what the
 * chart ends up holding.
 */
function usePublisher() {
    const kernel = useKernel();
    return (source: string): void => {
        const built = buildAddon({ [ENTRY_FILE]: source });
        if (built.kind !== 'ready') {
            throw new Error(built.message);
        }
        const id = registerAddon('draft', built.indicator);
        kernel.chart.updateIndicators((current) => (
            current.some((entry) => entry.indicatorId === id)
                ? [...current]
                : withIndicatorAdded({
                    added: current,
                    indicatorId: id,
                    settings: readLayerDefaults(built.indicator),
                    tone: 'phosphor',
                    isRepeatable: false,
                })
        ));
    };
}

afterEach(() => { forgetAddon(DRAFT_ID); });

function renderPublisher() {
    const kernel = createIndicatorKernel([]);
    const wrapper = ({ children }: { readonly children: ReactNode }): ReactElement => (
        <KernelProvider container={kernel.container}>{children}</KernelProvider>
    );
    const { result } = renderHook(() => usePublisher(), { wrapper });
    return { kernel, publish: result.current };
}

describe('putting a script on the chart as it is written', () => {
    it('adds the reading the first time it compiles', () => {
        const { kernel, publish } = renderPublisher();

        publish(sourceNamed('First'));

        expect(kernel.readAdded().map((entry) => entry.indicatorId)).toEqual([DRAFT_ID]);
    });

    it('replaces what it draws on the next edit rather than adding a second copy', () => {
        // The whole of the live preview: an edit lands on the chart as a
        // changed reading, not as another one beside it.
        const { kernel, publish } = renderPublisher();
        publish(sourceNamed('First'));

        publish(sourceNamed('Second'));

        expect(kernel.readAdded()).toHaveLength(1);
        expect(kernel.readPlans().map((plan) => plan.label)).toEqual(['Second']);
    });

    it('keeps the copy the reader tuned across an edit', () => {
        const { kernel, publish } = renderPublisher();
        publish(sourceNamed('First'));
        const before = kernel.readAdded()[0]!.instanceId;

        publish(sourceNamed('Second'));

        expect(kernel.readAdded()[0]!.instanceId).toBe(before);
    });

    it('draws what the reading actually computed', () => {
        const { kernel, publish } = renderPublisher();

        publish(sourceNamed('Mine'));

        const plan = kernel.readPlans()[0]!;
        expect(plan.series[0]!.value.length).toBeGreaterThan(0);
        expect(plan.scale).toEqual({ kind: 'price' });
    });
});
