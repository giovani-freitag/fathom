import { CONTROL_SQUARE_CLASSES } from '../control-shell.ts';
import { INSTANCE_TONES } from '../../../shared/core/draw-plan.ts';
import { isPale, OPENS_ON } from './tag-colours.ts';
import { PaintBucket } from 'lucide-react';
import type { ReactElement } from 'react';
import type { TagColour } from '../../../shared/core/pair-tags.ts';
import { TagSwatch } from './tag-swatch.tsx';
import { TONE_LABEL_KEYS } from '../indicators/tone-labels.ts';
import type { Translate } from '../../i18n/translator.ts';

interface ColourChoiceProps {
    readonly colour: TagColour;
    /** What the group is called, for a reader who cannot see the swatches. */
    readonly said: string;
    readonly translate: Translate;
    readonly onPick: (colour: TagColour) => void;
}

/**
 * The colour one thing is marked in: the chart's own five, or any there is.
 *
 * The chart's five first, because they are the ones that follow the reader
 * between themes and the ones already spoken for elsewhere on the page. Then the
 * whole spectrum, because tags are unlimited and five colours are not — a reader
 * on their eighth tag has run out of palette, not out of tags.
 *
 * Radios rather than pressed buttons: picking one unpicks the rest, and a set
 * that behaves that way announced as six separate switches tells a reader they
 * may hold two colours at once.
 */
export function ColourChoice({ colour, said, translate, onPick }: ColourChoiceProps): ReactElement {
    // A colour the reader named rather than took, which is the one case this
    // control has something of its own to show.
    const isNamed = colour.startsWith('#');

    return (
        <div className="flex flex-wrap items-center gap-2">
            {/* The five are the group; the picker beside them is not one of
                them, and claiming otherwise would count a control that opens the
                browser's own dialog as a sixth colour. */}
            <div role="radiogroup" aria-label={said} className="flex flex-wrap items-center gap-2">
                {INSTANCE_TONES.map((tone) => (
                    <button
                        key={tone}
                        type="button"
                        role="radio"
                        aria-checked={colour === tone}
                        aria-label={translate(TONE_LABEL_KEYS[tone])}
                        title={translate(TONE_LABEL_KEYS[tone])}
                        onClick={() => { onPick(tone); }}
                        className={`${CONTROL_SQUARE_CLASSES} rounded-lg border transition-colors ${
                            colour === tone
                                ? 'border-phosphor/60 bg-abyss-700'
                                : 'border-hairline hover:border-hairline-bright'
                        }`}
                    >
                        <TagSwatch colour={tone} className="size-4" />
                    </button>
                ))}
            </div>

            {/* The browser's own picker, as a filled disc with the glyph inside
                it: the same weight as the swatches beside it, and holding the
                colour it would change rather than a thin outline of one. */}
            <label
                title={translate('markets.anyColour')}
                className={`relative ${CONTROL_SQUARE_CLASSES} cursor-pointer rounded-lg border transition-colors ${
                    isNamed ? 'border-phosphor/60 bg-abyss-700' : 'border-hairline hover:border-hairline-bright'
                }`}
            >
                <span
                    className={`grid size-6 place-items-center rounded-full ${isNamed ? '' : 'bg-ink-600'}`}
                    {...isNamed ? { style: { background: colour } } : {}}
                >
                    {/* Black on a pale fill, white on a dark one: half of the
                        colours a reader may name swallow either glyph. */}
                    <PaintBucket
                        size={13}
                        className={isNamed && isPale(colour) ? 'text-abyss-900' : 'text-ink-100'}
                    />
                </span>
                <input
                    type="color"
                    name="tagColour"
                    aria-label={translate('markets.anyColour')}
                    value={isNamed ? colour : OPENS_ON}
                    onChange={(event) => { onPick(event.target.value as TagColour); }}
                    className="absolute inset-0 cursor-pointer opacity-0"
                />
            </label>
        </div>
    );
}
