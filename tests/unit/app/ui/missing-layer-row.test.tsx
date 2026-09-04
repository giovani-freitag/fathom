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

function renderList(
    removed: string[],
    alongside: readonly (typeof SHIPPED)[] = [],
    onEditReading?: (key?: string) => void,
) {
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

    renderWithKernel(
        kernel,
        <LayerList
            controls={controls}
            onOpenSettings={() => undefined}
            {...onEditReading === undefined ? {} : { onEditReading }}
        />,
    );
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

describe('a reading whose build is gone but whose source is not', () => {
    it('offers to open it in the editor, which is the repair that keeps the work', () => {
        // Removing the selection is the wrong fix when the script is still on
        // the shelf: opening it and saving again puts the reading back.
        const opened: (string | undefined)[] = [];

        renderList([], [], (key) => { opened.push(key); });
        fireEvent.click(screen.getByLabelText('Edit addon:deleted-last-week'));

        expect(opened).toEqual(['deleted-last-week']);
    });

    it('offers only removal where nothing can open it', () => {
        renderList([]);

        expect(screen.queryByLabelText(/^Edit /)).toBeNull();
        expect(screen.getAllByLabelText('Remove')).toHaveLength(1);
    });
});

describe('a reading that threw while the chart drew it', () => {
    it('is marked in the one list a reader looks at to find out why', () => {
        // Without it the only sign is a line quietly gone from the chart.
        const kernel = createIndicatorKernel([SHIPPED]);
        kernel.setState((state) => ({ ...state, layerFailures: { 'sma-1': 'it broke drawing' } }));
        const controls = {
            added: [SHIPPED],
            addedCounts: new Map(),
            isFull: false,
            remove: () => undefined,
            setVisibility: () => undefined,
        } as unknown as IndicatorControls;

        renderWithKernel(kernel, <LayerList controls={controls} onOpenSettings={() => undefined} />);

        expect(screen.getByLabelText('It drew nothing: it broke drawing')).toBeTruthy();
    });

    it('marks nothing where every reading drew', () => {
        renderList([], [SHIPPED]);

        expect(screen.queryByLabelText(/It drew nothing/)).toBeNull();
    });
});
