import type { ReactElement } from 'react';
import { INSTANCE_TONES, type PlotTone } from '../../shared/core/draw-plan.ts';
import type { DrawingControls } from '../react/use-drawings.ts';
import { FLOATING_PANEL_CLASSES } from './drawing-dock.tsx';
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

/** Sized like the dock below it: the strip is reached with the same thumb. */
const SWATCH_BUTTON_CLASSES = 'grid size-11 shrink-0 place-items-center rounded-lg';

interface DrawingPropertiesProps {
    readonly controls: DrawingControls;
}

/**
 * What can be changed about the mark that is selected.
 *
 * Shown only while something is selected: a row of colours with nothing to
 * colour is a row that has to be read before it can be dismissed.
 */
export function DrawingProperties({ controls }: DrawingPropertiesProps): ReactElement | null {
    const translate = useTranslate();
    if (controls.selectedId === null) {
        return null;
    }

    return (
        <div
            className={FLOATING_PANEL_CLASSES}
            role="group"
            aria-label={translate('drawing.tone')}
        >
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
                            controls.selectedTone === tone ? 'ring-2 ring-ink-100 ring-offset-2 ring-offset-abyss-800' : ''
                        }`}
                    />
                </button>
            ))}
        </div>
    );
}
