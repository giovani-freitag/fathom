import { Redo2, Trash2, Undo2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { Divider, DockButton } from './chart-dock.tsx';
import type { DrawingControls } from '../react/use-drawings.ts';
import { FLOATING_PANEL_CLASSES } from './control-shell.ts';
import { INSTANCE_TONES, type PlotTone } from '../../shared/core/draw-plan.ts';
import { useTranslate } from '../react/use-appearance.ts';

/** The class each tone's swatch is filled with, so the canvas and the page agree. */
const TONE_SWATCHES: Readonly<Record<PlotTone, string>> = {
    phosphor: 'bg-phosphor',
    amber: 'bg-amber',
    violet: 'bg-violet',
    cyan: 'bg-cyan',
    ask: 'bg-ask',
    bid: 'bg-bid',
    ink: 'bg-ink-100',
    muted: 'bg-ink-500',
};

const ICON_SIZE_PX = 18;

/** Reached with the same thumb as the dock below, so it is the same size. */
const SWATCH_BUTTON_CLASSES = 'grid size-10 shrink-0 place-items-center rounded-lg';

interface DrawingActionsProps {
    readonly controls: DrawingControls;
}

/**
 * What can be done to what is drawn, and to the mark that is selected.
 *
 * Above the tools rather than among them: stepping back is about the chart's
 * history, not about what the next press will draw, and the colours only make
 * sense while there is something to colour.
 */
export function DrawingActions({ controls }: DrawingActionsProps): ReactElement | null {
    const translate = useTranslate();
    const isSelected = controls.selectedId !== null;

    // Most readers never draw. A row of controls that could do nothing is a row
    // of chart they lost for the whole session.
    if (!isSelected && !controls.canUndo && !controls.canRedo) {
        return null;
    }

    return (
        <div className={FLOATING_PANEL_CLASSES} role="group" aria-label={translate('drawing.actions')}>
            {isSelected && (
                <>
                    {INSTANCE_TONES.map((tone) => (
                        <button
                            key={tone}
                            type="button"
                            aria-label={tone}
                            aria-pressed={controls.selectedTone === tone}
                            onClick={() => { controls.recolourSelected(tone); }}
                            className={SWATCH_BUTTON_CLASSES}
                        >
                            <span
                                className={`size-5 rounded-full ${TONE_SWATCHES[tone]} ${
                                    controls.selectedTone === tone
                                        ? 'ring-2 ring-ink-100 ring-offset-2 ring-offset-abyss-800'
                                        : ''
                                }`}
                            />
                        </button>
                    ))}
                    <Divider />
                </>
            )}

            <DockButton
                label={translate('drawing.undo')}
                isActive={false}
                isDisabled={!controls.canUndo}
                onPress={controls.undo}
            >
                <Undo2 size={ICON_SIZE_PX} />
            </DockButton>

            <DockButton
                label={translate('drawing.redo')}
                isActive={false}
                isDisabled={!controls.canRedo}
                onPress={controls.redo}
            >
                <Redo2 size={ICON_SIZE_PX} />
            </DockButton>

            <DockButton
                label={translate('drawing.remove')}
                isActive={false}
                isDisabled={!isSelected}
                onPress={controls.removeSelected}
            >
                <Trash2 size={ICON_SIZE_PX} />
            </DockButton>
        </div>
    );
}
