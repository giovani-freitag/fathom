import { INSTANCE_TONES, type PlotTone } from '../../../shared/core/draw-plan.ts';
import type { ReactElement } from 'react';
import type { TagColour } from '../../../shared/core/pair-tags.ts';
import { ToneSwatch } from '../indicators/tone-swatch.tsx';

interface TagSwatchProps {
    readonly colour: TagColour;
    readonly className?: string;
}

/**
 * The mark a tag puts on a row, in whichever kind of colour it holds.
 *
 * One of the chart's own goes through the palette, so it follows the reader
 * between the light theme and the dark one. One of the reader's own is written
 * as it stands, which is what they asked for by naming it.
 */
export function TagSwatch({ colour, className = '' }: TagSwatchProps): ReactElement {
    if (isTone(colour)) {
        return <ToneSwatch tone={colour} className={className} />;
    }

    return <span className={`block rounded-full ${className}`} style={{ background: colour }} />;
}

/**
 * Whether a tag's colour is one the chart names.
 */
function isTone(colour: TagColour): colour is PlotTone {
    return INSTANCE_TONES.some((tone) => tone === colour);
}
