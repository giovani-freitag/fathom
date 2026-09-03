import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { createIndicatorKernel, renderWithKernel } from '../../../mocks/indicator-kernel.tsx';
import { LayerList } from '../../../../src/app/ui/indicators/layer-list.tsx';
import type { IndicatorControls } from '../../../../src/app/react/use-indicators.ts';

/** A selection naming something this build cannot find, as storage can hold. */
const GONE = {
    instanceId: 'gone-1',
    indicatorId: 'addon:deleted-last-week',
    settings: {},
    tone: 'phosphor',
} as const;

/** A shipped reading, as the chart holds one. */
const SHIPPED = {
    instanceId: 'sma-1',
    indicatorId: 'sma',
    settings: {},
    tone: 'phosphor',
} as const;

function renderList(removed: string[], alongside: readonly (typeof SHIPPED)[] = []) {
    const kernel = createIndicatorKernel([...alongside]);
    const controls = {
        added: [GONE, ...alongside],
        addedCounts: new Map(),
        isFull: false,
        remove: (instanceId: string) => { removed.push(instanceId); },
        setVisibility: () => undefined,
        band: () => undefined,
        unband: () => undefined,
        pick: () => undefined,
    } as unknown as IndicatorControls;

    renderWithKernel(kernel, <LayerList controls={controls} onOpenSettings={() => undefined} />);
}

describe('a layer this build no longer has', () => {
    it('is shown rather than left out of the list', () => {
        // It drew nothing either way. The difference is whether the reader can
        // see the row well enough to tidy it up.
        renderList([], [SHIPPED]);

        expect(screen.getByText('A reading this build no longer has')).toBeTruthy();
    });

    it('can be taken off the chart', () => {
        const removed: string[] = [];
        renderList(removed, [SHIPPED]);

        fireEvent.click(screen.getAllByLabelText('Remove')[0]!);

        expect(removed).toEqual(['gone-1']);
    });

    it('names the id it was stored under, for a reader working out what it was', () => {
        renderList([]);

        expect(screen.getByTitle('addon:deleted-last-week')).toBeTruthy();
    });

    it('leaves every layer the build does have alone', () => {
        renderList([], [SHIPPED]);

        expect(screen.getByText('SMA')).toBeTruthy();
    });
});
