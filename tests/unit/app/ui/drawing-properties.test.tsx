import { createDrawingControls } from '../../../mocks/drawing-controls.ts';
import { FIRST_VENUE } from '../../../../src/shared/core/recording-control.ts';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { type Drawing, type DrawingKind, MAXIMUM_LABEL_LENGTH } from '../../../../src/shared/core/drawing.ts';
import type { DrawingRestyle, PendingLook } from '../../../../src/app/drawings/drawings-controller.ts';
import { DrawingProperties } from '../../../../src/app/ui/drawing-properties.tsx';
import { EN_DICTIONARY } from '../../../../src/app/i18n/dictionaries/en.ts';
import { createIndicatorKernel } from '../../../mocks/indicator-kernel.tsx';
import { INSTANCE_TONES } from '../../../../src/shared/core/draw-plan.ts';
import { TONE_LABEL_KEYS } from '../../../../src/app/ui/indicators/tone-labels.ts';
import { KernelProvider } from '../../../../src/app/react/kernel-provider.tsx';

const LEVEL: Drawing = {
    id: 'level',
    kind: 'horizontal-line',
    venue: FIRST_VENUE, instrumentSymbol: 'BTCUSDT',
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

    const controls = createDrawingControls({
        selectedId: selected === null ? null : selected.id,
        selected,
        restyleSelected: (look: DrawingRestyle) => { pressed.restyled.push(look); },
        removeSelected: () => { pressed.removed.push(1); },
    });

    render(
        <KernelProvider container={kernel.container}>
            <DrawingProperties controls={controls} />
        </KernelProvider>,
    );

    return pressed;
}

/** The panel as it opens on an armed tool, before anything has been drawn. */
function renderSetup(armedTool: DrawingKind, pending: Partial<PendingLook> = {}): Pressed {
    const pressed: Pressed = { restyled: [], removed: [] };
    const kernel = createIndicatorKernel([]);

    const controls = createDrawingControls({
        armedTool,
        pending: { tone: null, width: 'medium', style: 'solid', glyph: '\u{1F440}', ...pending },
        restylePending: (look: DrawingRestyle) => { pressed.restyled.push(look); },
    });

    render(
        <KernelProvider container={kernel.container}>
            <DrawingProperties controls={controls} />
        </KernelProvider>,
    );

    return pressed;
}

describe('DrawingProperties', () => {
    it('opens on a tool being armed, so a laser can be set up at all', () => {
        // A laser is gone by the time the hand lifts, so it is never a
        // selection: before the stroke is the only moment it can be coloured.
        renderSetup('laser');

        expect(screen.getByRole('group', { name: EN_DICTIONARY['drawing.tool.setup'] })).toBeTruthy();
    });

    it('sends what an armed tool is set to forward, not at a mark', () => {
        const pressed = renderSetup('laser');

        fireEvent.click(screen.getByRole('button', { name: EN_DICTIONARY[TONE_LABEL_KEYS['amber']] }));

        expect(pressed.restyled).toEqual([{ tone: 'amber' }]);
    });

    it('offers the laser a colour and a weight, and no line to break up', () => {
        // The painter draws a trail that fades along its length. A dashed one
        // is a line it has never drawn, so the control answered nothing.
        renderSetup('laser');

        expect(screen.queryByText(EN_DICTIONARY['drawing.colour'])).toBeTruthy();
        expect(screen.queryByText(EN_DICTIONARY['drawing.width'])).toBeTruthy();
        expect(screen.queryByText(EN_DICTIONARY['drawing.line'])).toBeNull();
    });

    it('asks an emoji for a size, never for a weight or a colour', () => {
        // A colour emoji carries its own and ignores the fill, and the weight
        // it is stored under is what the painter reads its type size out of.
        renderSetup('emoji');

        expect(screen.queryByText(EN_DICTIONARY['drawing.size'])).toBeTruthy();
        expect(screen.queryByText(EN_DICTIONARY['drawing.width'])).toBeNull();
        expect(screen.queryByText(EN_DICTIONARY['drawing.colour'])).toBeNull();
        expect(screen.queryByText(EN_DICTIONARY['drawing.line'])).toBeNull();
    });

    it('names an emoji size as a size rather than as a thickness', () => {
        renderSetup('emoji');

        expect(screen.getByRole('button', { name: EN_DICTIONARY['drawing.size.thick'] })).toBeTruthy();
        expect(screen.queryByRole('button', { name: EN_DICTIONARY['drawing.width.thick'] })).toBeNull();
    });

    it('offers the emoji this reader last pinned before the rest', () => {
        // The recently used tab is what the picker opens on, and the row is
        // ordered by the reader rather than by the catalogue.
        const controls = createDrawingControls({
            armedTool: 'emoji',
            recentGlyphs: ['\u{1F3AF}'],
            pending: { tone: null, width: 'medium', style: 'solid', glyph: '\u{1F440}' },
        });
        const kernel = createIndicatorKernel([]);

        render(
            <KernelProvider container={kernel.container}>
                <DrawingProperties controls={controls} />
            </KernelProvider>,
        );

        expect(screen.getByRole('button', { name: '\u{1F3AF}' })).toBeTruthy();
    });

    it('keeps the name field away from a tool that has drawn nothing', () => {
        // There is no mark to name yet, and a field that forgets what was
        // typed into it the moment the stroke begins is a field that lies.
        renderSetup('trend-line');

        expect(screen.queryByLabelText(EN_DICTIONARY['drawing.label'])).toBeNull();
    });

    it('keeps the delete button away from a tool that has drawn nothing', () => {
        renderSetup('trend-line');

        expect(screen.queryByRole('button', { name: EN_DICTIONARY['drawing.remove'] })).toBeNull();
    });

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
