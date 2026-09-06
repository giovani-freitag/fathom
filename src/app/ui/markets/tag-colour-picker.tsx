import { ColourChoice } from './colour-choice.tsx';
import { Popover } from 'radix-ui';
import type { ReactElement } from 'react';
import type { TagColour } from '../../../shared/core/pair-tags.ts';
import { TagSwatch } from './tag-swatch.tsx';
import type { Translate } from '../../i18n/translator.ts';

interface TagColourPickerProps {
    readonly colour: TagColour;
    /** What the tag is called, so the control says which one it colours. */
    readonly label: string;
    readonly translate: Translate;
    readonly onPick: (colour: TagColour) => void;
}

/**
 * The colour one tag is marked in, reached from the tag's own mark.
 *
 * The swatch is the control as well as the answer: a reader looking for what
 * colour a tag is is already pointing at where it is changed.
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
                    <ColourChoice
                        colour={colour}
                        said={translate('markets.recolourTag')}
                        translate={translate}
                        onPick={onPick}
                    />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
