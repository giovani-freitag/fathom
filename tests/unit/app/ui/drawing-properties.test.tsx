import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { type Drawing, MAXIMUM_LABEL_LENGTH } from '../../../../src/shared/core/drawing.ts';
import type { DrawingControls } from '../../../../src/app/react/use-drawings.ts';
import type { DrawingRestyle } from '../../../../src/app/drawings/drawings-controller.ts';
import { DrawingProperties } from '../../../../src/app/ui/drawing-properties.tsx';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { INSTANCE_TONES } from '../../../../src/shared/core/draw-plan.ts';
import { TONE_LABEL_KEYS } from '../../../../src/app/ui/indicators/tone-labels.ts';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';

const LEVEL: Drawing = {
    id: 'level',
    kind: 'horizontal-line',
    instrumentSymbol: 'BTCUSDT',
    anchors: [{ atMs: 1_000, price: 100 }],
    tone: 'phosphor',
};

interface Pressed {
    readonly restyled: DrawingRestyle[];
    readonly removed: number[];
}

function renderPanel(selected: Drawing | null): Pressed {
    const pressed: Pressed = { restyled: [], removed: [] };
    const kernel = createIndicatorKernel([]);

    const controls = {
        armedTool: null,
        isToolLocked: false,
        toggleToolLock: () => undefined,
        selectedId: selected === null ? null : selected.id,
        selected,
        canUndo: false,
        canRedo: false,
        toggleTool: () => undefined,
        disarm: () => undefined,
        restyleSelected: (look: DrawingRestyle) => { pressed.restyled.push(look); },
        removeSelected: () => { pressed.removed.push(1); },
        undo: () => undefined,
        redo: () => undefined,
    } satisfies DrawingControls;

    render(
        <KernelProvider container={kernel.container}>
            <DrawingProperties controls={controls} />
        </KernelProvider>,
    );

    return pressed;
}

describe('DrawingProperties', () => {
    it('stays away while nothing is selected', () => {
        renderPanel(null);

        expect(screen.queryByRole('group', { name: EN_DICTIONARY['drawing.properties'] })).toBeNull();
    });

    it('opens on the selection itself, with no control to find first', () => {
        // A reader who has just pressed a mark has said what they want to work
        // on; asking them to say it again is a press they should not make.
        renderPanel(LEVEL);

        expect(screen.getByRole('group', { name: EN_DICTIONARY['drawing.properties'] })).toBeTruthy();
    });

    it('offers every tone a mark can be told apart by', () => {
        renderPanel(LEVEL);

        // Named by colour, not by token: a reader who cannot see the swatch
        // hears what it is, and "ask" is a place a colour is used rather than
        // a colour.
        const offered = INSTANCE_TONES.filter((tone) => (
            screen.queryByRole('button', { name: EN_DICTIONARY[TONE_LABEL_KEYS[tone]] }) !== null
        ));
        expect(offered).toHaveLength(INSTANCE_TONES.length);
    });

    it('shows the tone the mark already carries', () => {
        renderPanel(LEVEL);

        expect(screen.getByRole('button', { name: EN_DICTIONARY['colour.teal'] })
            .getAttribute('aria-pressed')).toBe('true');
    });

    it('paints it in the tone that was pressed', () => {
        const pressed = renderPanel(LEVEL);

        screen.getByRole('button', { name: EN_DICTIONARY['colour.amber'] }).click();

        expect(pressed.restyled).toEqual([{ tone: 'amber' }]);
    });

    it('offers a weight to draw it at', () => {
        const pressed = renderPanel(LEVEL);

        screen.getByRole('button', { name: EN_DICTIONARY['drawing.width.thick'] }).click();

        expect(pressed.restyled).toEqual([{ width: 'thick' }]);
    });

    it('offers a line to draw it with', () => {
        const pressed = renderPanel(LEVEL);

        screen.getByRole('button', { name: EN_DICTIONARY['drawing.line.dashed'] }).click();

        expect(pressed.restyled).toEqual([{ style: 'dashed' }]);
    });

    it('shows what a mark stored before either existed is drawn as', () => {
        // It says nothing about weight or line, and is drawn anyway.
        renderPanel(LEVEL);

        expect(screen.getByRole('button', { name: EN_DICTIONARY['drawing.width.medium'] })
            .getAttribute('aria-pressed')).toBe('true');
    });

    it('takes the mark off the chart', () => {
        const pressed = renderPanel(LEVEL);

        screen.getByRole('button', { name: EN_DICTIONARY['drawing.remove'] }).click();

        expect(pressed.removed).toEqual([1]);
    });
});

describe('DrawingProperties naming a mark', () => {
    it('offers the name a mark already carries', () => {
        renderPanel({ ...LEVEL, label: 'support' });

        expect(screen.getByDisplayValue('support')).toBeTruthy();
    });

    it('offers an empty name for a mark that was never named', () => {
        renderPanel(LEVEL);

        const field = screen.getByPlaceholderText(EN_DICTIONARY['drawing.label.placeholder']);

        expect((field as HTMLInputElement).value).toBe('');
    });

    it('renames the mark as the reader types', () => {
        const pressed = renderPanel(LEVEL);

        fireEvent.change(
            screen.getByPlaceholderText(EN_DICTIONARY['drawing.label.placeholder']),
            { target: { value: 'support' } },
        );

        expect(pressed.restyled).toEqual([{ label: 'support' }]);
    });

    it('holds the space a reader pressed, so a name can reach its second word', () => {
        renderPanel({ ...LEVEL, label: 'suporte ' });

        const field = screen.getByPlaceholderText(EN_DICTIONARY['drawing.label.placeholder']);

        expect((field as HTMLInputElement).value).toBe('suporte ');
    });

    it('will not take a name longer than the chart can carry', () => {
        renderPanel(LEVEL);

        const field = screen.getByPlaceholderText(EN_DICTIONARY['drawing.label.placeholder']);

        expect((field as HTMLInputElement).maxLength).toBe(MAXIMUM_LABEL_LENGTH);
    });
});
