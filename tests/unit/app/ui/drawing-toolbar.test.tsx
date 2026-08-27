import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DrawingToolbar } from '../../../../src/app/ui/drawing-toolbar.tsx';
import type { DrawingControls } from '../../../../src/app/react/use-drawings.ts';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';

interface Rendered {
    readonly armed: (string | null)[];
    readonly removed: number[];
}

function renderToolbar(overrides: Partial<DrawingControls> = {}): Rendered {
    const armed: (string | null)[] = [];
    const removed: number[] = [];
    const kernel = createIndicatorKernel([]);

    const controls: DrawingControls = {
        armedTool: null,
        selectedId: null,
        toggleTool: (kind) => { armed.push(kind); },
        removeSelected: () => { removed.push(1); },
        ...overrides,
    };

    render(
        <KernelProvider container={kernel.container}>
            <DrawingToolbar controls={controls} />
        </KernelProvider>,
    );

    return { armed, removed };
}

describe('DrawingToolbar', () => {
    it('offers a tool for every kind of mark the build draws', () => {
        renderToolbar();

        expect([
            screen.getByRole('button', { name: EN_DICTIONARY['drawing.horizontalLine'] }),
            screen.getByRole('button', { name: EN_DICTIONARY['drawing.trendLine'] }),
        ]).toHaveLength(2);
    });

    it('arms the tool that was pressed', () => {
        const rendered = renderToolbar();

        screen.getByRole('button', { name: EN_DICTIONARY['drawing.trendLine'] }).click();

        expect(rendered.armed).toEqual(['trend-line']);
    });

    it('shows which tool is armed, so a reader knows what a press will do', () => {
        renderToolbar({ armedTool: 'trend-line' });

        expect(screen.getByRole('button', { name: EN_DICTIONARY['drawing.trendLine'] })
            .getAttribute('aria-pressed')).toBe('true');
    });

    it('offers no removal while nothing is selected', () => {
        renderToolbar();

        const remove = screen.getByRole('button', { name: EN_DICTIONARY['drawing.remove'] });
        expect((remove as HTMLButtonElement).disabled).toBe(true);
    });

    it('removes the mark that is selected', () => {
        const rendered = renderToolbar({ selectedId: 'level' });

        screen.getByRole('button', { name: EN_DICTIONARY['drawing.remove'] }).click();

        expect(rendered.removed).toEqual([1]);
    });

    it('names itself, so a reader arriving by keyboard knows what it is', () => {
        renderToolbar();

        expect(screen.getByRole('toolbar', { name: EN_DICTIONARY['drawing.toolbar'] })).toBeTruthy();
    });
});
