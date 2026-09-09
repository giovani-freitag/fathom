import { INSTANCE_TONES } from '../../../shared/core/draw-plan.ts';
import { ColourChoice } from '../colour-choice.tsx';
import { CONTROL_CHIP_CLASSES, CONTROL_CHOSEN_CLASSES, CONTROL_INPUT_CLASSES, CONTROL_OFFERED_CLASSES } from '../control-shell.ts';
import { useEscapeGuard } from '../escape-guard.ts';
import { type ReactElement, useState } from 'react';
import type { PairTag, TagColour } from '../../../shared/core/pair-tags.ts';
import { labelOf } from '../../markets/tag-names.ts';
import type { Translate } from '../../i18n/translator.ts';

export interface TagCardProps {
    readonly translate: Translate;
    /** The tag being changed, or nothing where one is being made. */
    readonly tag?: PairTag | undefined;
    /** Called with everything the tag needs, whether it exists yet or not. */
    readonly onSave: (label: string, colour: TagColour) => void;
    readonly onGiveUp: () => void;
    /** Offered only where there is a tag and it is one that may be taken away. */
    readonly onRemove?: (() => void) | undefined;
}

/**
 * Where a tag is given its name and its colour.
 *
 * Both at once, because they are one decision: a tag is a colour a reader
 * recognises down a column of rows, and a name they read when they cannot. Made
 * first and recoloured afterwards, the tag spends its first minutes in whatever
 * colour happened to be next in the list, which is the minutes a reader is
 * learning to recognise it.
 *
 * One card for making and for changing, because they ask the same two questions
 * and a second card written to look like the first stops looking like it on the
 * next change.
 */
export function TagCard({ translate, tag, onSave, onGiveUp, onRemove }: TagCardProps): ReactElement {
    // The sheet this sits in closes on Escape, and Radix decides that before any
    // handler here runs. Without the claim, giving up on a half-typed name took
    // the whole sheet with it — the very thing the guard was written to stop,
    // and carried until now only by the shape that is being deleted.
    useEscapeGuard(true);
    // Seeded with what the tag stores rather than with what it is called: the
    // first tag's name is held in the dictionary rather than in storage, so it
    // follows the reader's language, and writing the translation back into it
    // on a save that only changed the colour would pin it to one.
    const [label, setLabel] = useState(tag?.label ?? '');
    // The first tone rather than a colour of its own: a tag a reader makes
    // without touching this is still one they can pick out of a column.
    const [colour, setColour] = useState<TagColour>(tag?.colour ?? INSTANCE_TONES[0] ?? 'phosphor');
    // A blank name makes nothing, but leaves an existing tag as it was called —
    // which is the whole of what a reader who came here for the colour wants.
    const isSayable = tag !== undefined || label.trim() !== '';

    return (
        <div
            className="flex min-h-0 flex-1 flex-col"
            // On the card rather than on the field: with the key claimed, a
            // press while focus sits on a swatch or a button would otherwise do
            // nothing at all, where before it at least closed something.
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    onGiveUp();
                }
            }}
        >
            {/* The card scrolls and the answer does not. With the
                name field focused the phone keyboard takes half the
                screen, which is the ordinary state of this card and
                not an edge of it — and both buttons sat below the
                fold with nothing to scroll. Enter still made the
                tag; giving up had no way out at all. */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                <label className="flex flex-col gap-1.5">
                    <span className="field-label">{translate('markets.tagLabel')}</span>
                    <input
                        autoFocus
                        type="text"
                        name="tagLabel"
                        value={label}
                        placeholder={tag === undefined ? translate('markets.tagLabel') : labelOf(tag, translate)}
                        autoCapitalize="off"
                        autoCorrect="off"
                        onChange={(event) => { setLabel(event.target.value); }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && isSayable) {
                                onSave(label, colour);
                            }
                            if (event.key === 'Escape') {
                                onGiveUp();
                            }
                        }}
                        className={`${CONTROL_INPUT_CLASSES} px-3`}
                    />
                </label>

                <fieldset className="flex flex-col gap-1.5">
                    <legend className="field-label">{translate('markets.tagColour')}</legend>
                    <ColourChoice
                        colour={colour}
                        said={translate('markets.tagColour')}
                        translate={translate}
                        onPick={setColour}
                    />
                </fieldset>

                {/* At the end of what scrolls rather than beside the button that
                    saves: on a phone the two would be a thumb's width apart, and
                    one of them cannot be undone. */}
                {onRemove !== undefined && (
                    <button
                        type="button"
                        onClick={onRemove}
                        className={`${CONTROL_CHIP_CLASSES} mt-2 w-full justify-center border-hairline text-amber hover:border-amber/60`}
                    >
                        {translate('markets.removeTag')}
                    </button>
                )}
            </div>

            <div className="flex shrink-0 gap-2 border-t border-hairline p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button
                    type="button"
                    onClick={onGiveUp}
                    className={`${CONTROL_CHIP_CLASSES} flex-1 justify-center ${CONTROL_OFFERED_CLASSES}`}
                >
                    {translate('markets.giveUp')}
                </button>
                <button
                    type="button"
                    disabled={!isSayable}
                    onClick={() => { onSave(label, colour); }}
                    className={`${CONTROL_CHIP_CLASSES} flex-1 justify-center ${CONTROL_CHOSEN_CLASSES}`}
                >
                    {translate(tag === undefined ? 'markets.makeTag' : 'markets.saveTag')}
                </button>
            </div>
        </div>
    );
}
