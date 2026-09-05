import { INSTANCE_TONES } from '../../../shared/core/draw-plan.ts';
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

                        {/* The browser's own, which is the one control on this
                            page that can offer every colour there is without
                            teaching the reader a new one. */}
                        <label className="grid size-7 cursor-pointer place-items-center rounded-md border border-hairline transition-colors hover:border-hairline-bright">
                            <span className="sr-only">{translate('markets.anyColour')}</span>
                            <input
                                type="color"
                                name="tagColour"
                                aria-label={translate('markets.anyColour')}
                                value={colour.startsWith('#') ? colour : OPENS_ON}
                                onChange={(event) => { onPick(event.target.value as TagColour); }}
                                className="size-4 cursor-pointer appearance-none border-0 bg-transparent p-0"
                            />
                        </label>
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
