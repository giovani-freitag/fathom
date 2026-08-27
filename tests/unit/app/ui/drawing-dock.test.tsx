import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DrawingDock } from '../../../../src/app/ui/drawing-dock.tsx';
import { DrawingProperties } from '../../../../src/app/ui/drawing-properties.tsx';
import type { DrawingControls } from '../../../../src/app/react/use-drawings.ts';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { INSTANCE_TONES, type PlotTone } from '../../../../src/shared/core/draw-plan.ts';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';

interface Pressed {
    readonly armed: (string | null)[];
    readonly disarmed: number[];
    readonly recoloured: PlotTone[];
    readonly removed: number[];
}

function buildControls(overrides: Partial<DrawingControls>, pressed: Pressed): DrawingControls {
    return {
        armedTool: null,
        selectedId: null,
        selectedTone: null,
        toggleTool: (kind) => { pressed.armed.push(kind); },
        disarm: () => { pressed.disarmed.push(1); },
        recolourSelected: (tone) => { pressed.recoloured.push(tone); },
        removeSelected: () => { pressed.removed.push(1); },
        ...overrides,
    };
}

function renderDock(overrides: Partial<DrawingControls> = {}): Pressed {
    const pressed: Pressed = { armed: [], disarmed: [], recoloured: [], removed: [] };
    const kernel = createIndicatorKernel([]);

    render(
        <KernelProvider container={kernel.container}>
            <DrawingDock controls={buildControls(overrides, pressed)} />
            <DrawingProperties controls={buildControls(overrides, pressed)} />
        </KernelProvider>,
    );

    return pressed;
}

/** One control of the dock, by the words it is announced with. */
function control(labelKey: keyof typeof EN_DICTIONARY): HTMLButtonElement {
    return screen.getByRole<HTMLButtonElement>('button', { name: EN_DICTIONARY[labelKey] });
}

describe('DrawingDock', () => {
    it('offers a tool for every kind of mark the build draws', () => {
        renderDock();

        expect([
            control('drawing.horizontalLine'),
            control('drawing.trendLine'),
            control('drawing.zone'),
        ]).toHaveLength(3);
    });

    it('shows the pointer as the tool in force while none is armed', () => {
        // Nothing highlighted reads as a broken control rather than as a chart
        // that pans, so the resting state is a tool of its own.
        renderDock();

        expect(control('drawing.select').getAttribute('aria-pressed')).toBe('true');
    });

    it('arms the tool that was pressed', () => {
        const pressed = renderDock();

        control('drawing.zone').click();

        expect(pressed.armed).toEqual(['zone']);
    });

    it('puts every tool down when the pointer is pressed', () => {
        const pressed = renderDock({ armedTool: 'zone' });

        control('drawing.select').click();

        expect(pressed.disarmed).toEqual([1]);
    });

    it('shows which tool is armed, so a reader knows what a press will do', () => {
        renderDock({ armedTool: 'trend-line' });

        expect(control('drawing.trendLine').getAttribute('aria-pressed')).toBe('true');
    });

    it('offers no removal while nothing is selected', () => {
        renderDock();

        expect(control('drawing.remove').disabled).toBe(true);
    });

    it('removes the mark that is selected', () => {
        const pressed = renderDock({ selectedId: 'level' });

        control('drawing.remove').click();

        expect(pressed.removed).toEqual([1]);
    });

    it('names itself, so a reader arriving by keyboard knows what it is', () => {
        renderDock();

        expect(screen.getByRole('toolbar', { name: EN_DICTIONARY['drawing.toolbar'] })).toBeTruthy();
    });
});

describe('DrawingProperties', () => {
    it('stays out of the way while nothing is selected', () => {
        // A row of colours with nothing to colour is a row that has to be read
        // before it can be dismissed.
        renderDock();

        expect(screen.queryByRole('group', { name: EN_DICTIONARY['drawing.tone'] })).toBeNull();
    });

    it('offers every tone a mark can be told apart by', () => {
        renderDock({ selectedId: 'level', selectedTone: 'phosphor' });

        const swatches = screen.getByRole('group', { name: EN_DICTIONARY['drawing.tone'] })
            .querySelectorAll('button');
        expect(swatches).toHaveLength(INSTANCE_TONES.length);
    });

    it('paints the selected mark in the tone that was pressed', () => {
        const pressed = renderDock({ selectedId: 'level', selectedTone: 'phosphor' });

        screen.getByRole('button', { name: 'amber' }).click();

        expect(pressed.recoloured).toEqual(['amber']);
    });

    it('shows which tone the selected mark already carries', () => {
        renderDock({ selectedId: 'level', selectedTone: 'cyan' });

        expect(screen.getByRole('button', { name: 'cyan' }).getAttribute('aria-pressed')).toBe('true');
    });
});
