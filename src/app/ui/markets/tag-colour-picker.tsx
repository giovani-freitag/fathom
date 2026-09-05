import { INSTANCE_TONES } from '../../../shared/core/draw-plan.ts';
import { PaintBucket } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { ReactElement } from 'react';
import type { TagColour } from '../../../shared/core/pair-tags.ts';
import { TagSwatch } from './tag-swatch.tsx';
import { TONE_LABEL_KEYS } from '../indicators/tone-labels.ts';
import type { Translate } from '../../i18n/translator.ts';

/** What the colour field opens on, where the tag holds a token rather than one. */
const OPENS_ON = '#35e0c4';

/** Where a colour stops taking a dark glyph and starts needing a light one. */
const PALE_ENOUGH = 0.55;

/**
 * Whether a colour is light enough to draw a dark glyph on.
 *
 * By the luminance the eye actually reads rather than by the three channels
 * evenly: green carries most of the brightness, and blue almost none, so a
 * plain average calls a saturated blue pale and hides the glyph on it.
 *
 * @param colour - A colour written as six hexadecimal digits.
 * @returns True where the glyph over it should be dark.
 */
function isPale(colour: string): boolean {
    const red = Number.parseInt(colour.slice(1, 3), 16) / 255;
    const green = Number.parseInt(colour.slice(3, 5), 16) / 255;
    const blue = Number.parseInt(colour.slice(5, 7), 16) / 255;

    return 0.2126 * red + 0.7152 * green + 0.0722 * blue > PALE_ENOUGH;
}

interface TagColourPickerProps {
    readonly colour: TagColour;
    /** What the tag is called, so the control says which one it colours. */
    readonly label: string;
    readonly translate: Translate;
    readonly onPick: (colour: TagColour) => void;
}

/**
 * The colour one tag is marked in.
 *
 * The chart's own five first, because they are the ones that follow the reader
 * between themes and the ones already spoken for elsewhere on the page. Then
 * the whole spectrum, because tags are unlimited and five colours are not — a
 * reader on their eighth tag has run out of palette, not out of tags.
 */
export function TagColourPicker({ colour, label, translate, onPick }: TagColourPickerProps): ReactElement {
    // A colour the reader named rather than took, which is the one case this
    // control has something of its own to show.
    const isNamed = colour.startsWith('#');

    return (
        <Popover.Root>
            <Popover.Trigger
                aria-label={`${translate('markets.recolourTag')} — ${label}`}
                title={translate('markets.recolourTag')}
                className="grid size-7 shrink-0 place-items-center rounded transition-colors hover:bg-abyss-700"
            >
                <TagSwatch colour={colour} className="size-2.5" />
            </Popover.Trigger>

            <Popover.Portal>
                <Popover.Content
                    align="start"
                    sideOffset={6}
                    collisionPadding={12}
                    className="z-[60] rounded-lg border border-hairline bg-abyss-800 p-2 shadow-2xl shadow-black/60"
                >
                    <div className="flex items-center gap-1.5">
                        {INSTANCE_TONES.map((tone) => (
                            <button
                                key={tone}
                                type="button"
                                aria-label={translate(TONE_LABEL_KEYS[tone])}
                                aria-pressed={colour === tone}
                                onClick={() => { onPick(tone); }}
                                className={`grid size-7 place-items-center rounded-md border transition-colors ${
                                    colour === tone ? 'border-phosphor/60 bg-abyss-700' : 'border-hairline hover:border-hairline-bright'
                                }`}
                            >
                                <TagSwatch colour={tone} className="size-3.5" />
                            </button>
                        ))}

                        {/* The browser's own picker, as a filled disc with the
                            glyph inside it: the same weight as the swatches
                            beside it, and holding the colour it would change
                            rather than a thin outline of one. */}
                        <label
                            title={translate('markets.anyColour')}
                            className={`relative grid size-7 cursor-pointer place-items-center rounded-md border transition-colors ${
                                isNamed ? 'border-phosphor/60 bg-abyss-700' : 'border-hairline hover:border-hairline-bright'
                            }`}
                        >
                            <span
                                className={`grid size-5 place-items-center rounded-full ${isNamed ? '' : 'bg-ink-600'}`}
                                {...isNamed ? { style: { background: colour } } : {}}
                            >
                                {/* Black on a pale fill, white on a dark one:
                                    a reader may name any colour there is, and
                                    half of them swallow either glyph. */}
                                <PaintBucket
                                    size={11}
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
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
