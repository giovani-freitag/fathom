import { INSTANCE_TONES } from '../../../shared/core/draw-plan.ts';
import { Pipette } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { ReactElement } from 'react';
import type { TagColour } from '../../../shared/core/pair-tags.ts';
import { TagSwatch } from './tag-swatch.tsx';
import { TONE_LABEL_KEYS } from '../indicators/tone-labels.ts';
import type { Translate } from '../../i18n/translator.ts';

/** What the colour field opens on, where the tag holds a token rather than one. */
const OPENS_ON = '#35e0c4';

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

                        {/* The browser's own picker, behind an icon rather than
                            behind its own swatch: a sixth circle of colour in a
                            row of five reads as a sixth colour to choose, and
                            the one thing this control is not is a colour. */}
                        <label
                            title={translate('markets.anyColour')}
                            className={`relative grid size-7 cursor-pointer place-items-center rounded-md border transition-colors ${
                                isNamed ? 'border-phosphor/60 bg-abyss-700' : 'border-hairline hover:border-hairline-bright'
                            }`}
                        >
                            <Pipette
                                size={14}
                                className={isNamed ? '' : 'text-ink-400'}
                                {...isNamed ? { style: { color: colour } } : {}}
                            />
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
