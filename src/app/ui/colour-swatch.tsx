import { INSTANCE_TONES, type PlotTone } from '../../shared/core/draw-plan.ts';
import type { ReactElement } from 'react';
import type { TagColour } from '../../shared/core/pair-tags.ts';
import { ToneSwatch } from './indicators/tone-swatch.tsx';

interface ColourSwatchProps {
    readonly colour: TagColour;
    readonly className?: string;
}

/**
 * A colour shown as a disc, in whichever kind of colour it is held as.
 *
 * One of the chart's own goes through the palette, so it follows the reader
 * between the light theme and the dark one. One of the reader's own is written
 * as it stands, which is what they asked for by naming it.
 *
 * Wherever a colour is offered or shown — a tag down the rail, a mark on the
 * chart — it is this, so the same colour is never two different discs.
 */
export function ColourSwatch({ colour, className = '' }: ColourSwatchProps): ReactElement {
    if (isTone(colour)) {
        return <ToneSwatch tone={colour} className={className} />;
    }

    return <span className={`block rounded-full ${className}`} style={{ background: colour }} />;
}

/**
 * Whether a colour is one the chart names rather than one a reader wrote.
 */
function isTone(colour: TagColour): colour is PlotTone {
    return INSTANCE_TONES.some((tone) => tone === colour);
}
