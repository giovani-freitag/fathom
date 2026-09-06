import { CONTROL_CHIP_CLASSES, CONTROL_CHOSEN_CLASSES, CONTROL_INPUT_CLASSES, CONTROL_OFFERED_CLASSES } from '../control-shell.ts';
import { INSTANCE_TONES } from '../../../shared/core/draw-plan.ts';
import { useEscapeGuard } from '../escape-guard.ts';
import { isPale, OPENS_ON } from './tag-colours.ts';
import { PaintBucket } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import type { TagColour } from '../../../shared/core/pair-tags.ts';
import { TagSwatch } from './tag-swatch.tsx';
import { TONE_LABEL_KEYS } from '../indicators/tone-labels.ts';
import type { Translate } from '../../i18n/translator.ts';

export interface NewTagCardProps {
    readonly translate: Translate;
    /** Called with everything the tag needs to exist. */
    readonly onMake: (label: string, colour: TagColour) => void;
    readonly onGiveUp: () => void;
}

/**
 * Where a tag is given its name and its colour, before it exists.
 *
 * Both at once, because they are one decision: a tag is a colour a reader
 * recognises down a column of rows, and a name they read when they cannot. Made
 * first and recoloured afterwards, the tag spends its first minutes in whatever
 * colour happened to be next in the list, which is the minutes a reader is
 * learning to recognise it.
 */
export function NewTagCard({ translate, onMake, onGiveUp }: NewTagCardProps): ReactElement {
    // The sheet this sits in closes on Escape, and Radix decides that before any
    // handler here runs. Without the claim, giving up on a half-typed name took
    // the whole sheet with it — the very thing the guard was written to stop,
    // and carried until now only by the shape that is being deleted.
    useEscapeGuard(true);
    const [label, setLabel] = useState('');
    // The first tone rather than a colour of its own: a tag a reader makes
    // without touching this is still one they can pick out of a column.
    const [colour, setColour] = useState<TagColour>(INSTANCE_TONES[0] ?? 'phosphor');
    // A colour the reader named rather than took, which is the one case the
    // control has something of its own to show.
    const isNamed = colour.startsWith('#');

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
                        placeholder={translate('markets.tagLabel')}
                        autoCapitalize="off"
                        autoCorrect="off"
                        onChange={(event) => { setLabel(event.target.value); }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && label.trim() !== '') {
                                onMake(label, colour);
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
                    <div className="flex flex-wrap gap-2">
                        {INSTANCE_TONES.map((tone) => (
                            <button
                                key={tone}
                                type="button"
                                aria-label={translate(TONE_LABEL_KEYS[tone])}
                                aria-pressed={colour === tone}
                                onClick={() => { setColour(tone); }}
                                className={`grid size-11 place-items-center rounded-md border transition-colors ${
                                    colour === tone
                                        ? 'border-phosphor/60 bg-abyss-700'
                                        : 'border-hairline hover:border-hairline-bright'
                                }`}
                            >
                                <TagSwatch colour={tone} className="size-4" />
                            </button>
                        ))}

                        {/* Any colour there is, for a reader whose tags outnumber
                        the palette. The same control the recolour offers, so a
                        tag made here and a tag recoloured later are picked the
                        same way. */}
                        <label
                            title={translate('markets.anyColour')}
                            className={`relative grid size-11 cursor-pointer place-items-center rounded-md border transition-colors ${
                                isNamed ? 'border-phosphor/60 bg-abyss-700' : 'border-hairline hover:border-hairline-bright'
                            }`}
                        >
                            <span
                                className={`grid size-7 place-items-center rounded-full ${isNamed ? '' : 'bg-ink-600'}`}
                                {...isNamed ? { style: { background: colour } } : {}}
                            >
                                {/* Black on a pale fill, white on a dark one: half
                                of the colours a reader may name swallow either
                                glyph. */}
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
                                onChange={(event) => { setColour(event.target.value as TagColour); }}
                                className="absolute inset-0 cursor-pointer opacity-0"
                            />
                        </label>
                    </div>
                </fieldset>

            </div>

            <div className="flex shrink-0 gap-2 border-t border-hairline p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button
                    type="button"
                    onClick={onGiveUp}
                    className={`${CONTROL_CHIP_CLASSES} h-11 flex-1 justify-center ${CONTROL_OFFERED_CLASSES}`}
                >
                    {translate('markets.giveUp')}
                </button>
                <button
                    type="button"
                    disabled={label.trim() === ''}
                    onClick={() => { onMake(label, colour); }}
                    className={`${CONTROL_CHIP_CLASSES} h-11 flex-1 justify-center ${CONTROL_CHOSEN_CLASSES}`}
                >
                    {translate('markets.makeTag')}
                </button>
            </div>
        </div>
    );
}
