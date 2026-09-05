import type { ReactElement } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CONTROL_CHOSEN_CLASSES, CONTROL_INPUT_CLASSES, SCROLLER_CLASSES } from '../control-shell.ts';
import { FAVOURITES_ID, type PairTag, type TagColour } from '../../../shared/core/pair-tags.ts';
import { labelOf } from '../../markets/tag-names.ts';
import { TagColourPicker } from './tag-colour-picker.tsx';
import type { Translate } from '../../i18n/translator.ts';
import { useState } from 'react';

/** What the listing beside the rail is showing. */
export type Showing =
    | { readonly kind: 'tag' }
    | { readonly kind: 'venue'; readonly venue: string };

interface MarketsRailProps {
    readonly tags: readonly PairTag[];
    readonly venues: readonly string[];
    /** Which tag a press files under, which is also a tag the rail can be on. */
    readonly openTagId: string;
    readonly showing: Showing;
    readonly translate: Translate;
    readonly onOpenTag: (tagId: string) => void;
    readonly onBrowse: (venue: string) => void;
    readonly onAddTag: (label: string) => void;
    readonly onRemoveTag: (tagId: string) => void;
    readonly onRecolourTag: (tagId: string, colour: TagColour) => void;
    /** Takes a venue the reader brought back off. The shipped one has no such offer. */
    readonly onRemoveVenue: (venue: string) => void;
    /** Which venues the reader brought, and so may take away again. */
    readonly broughtVenues: ReadonlySet<string>;
    /** Absent where this build carries no editor to write a connector in. */
    readonly onWriteConnector?: (() => void) | undefined;
}

/**
 * Everything a reader can point the listing at, down one side.
 *
 * Their tags and the venues in one rail rather than in two stacked panels: the
 * question is "which of these am I looking at", and answering it in two places
 * meant a reader who wanted a pair from a second venue had to find out that
 * browsing and keeping were different halves of the same card.
 *
 * On a phone the same rail lies down and scrolls sideways above the listing,
 * because a column of targets beside a column of rows leaves neither enough
 * width to read.
 */
export function MarketsRail(props: MarketsRailProps): ReactElement {
    const { translate } = props;
    const [isNaming, setIsNaming] = useState(false);

    return (
        <nav
            aria-label={translate('markets.title')}
            // The same fade the tool bar uses when it lies down: a chip cut by a
            // fade reads as one that continues, and a scrollbar under a row of
            // targets on a phone is a second thing to drag.
            className={`flex shrink-0 gap-1 overflow-x-auto border-hairline p-2 ${SCROLLER_CLASSES}`
                + ' lg:w-56 lg:flex-col lg:overflow-y-auto lg:border-r lg:[mask-image:none]'}
        >
            <RailHeading said={translate('markets.yourTags')} />
            {props.tags.map((tag) => (
                <TagRow
                    key={tag.id}
                    said={labelOf(tag, translate)}
                    colour={tag.colour}
                    count={tag.pairs.length}
                    isOn={props.showing.kind === 'tag' && props.openTagId === tag.id}
                    translate={translate}
                    onPress={() => { props.onOpenTag(tag.id); }}
                    onRecolour={(colour) => { props.onRecolourTag(tag.id, colour); }}
                    {...tag.id === FAVOURITES_ID
                        ? {}
                        : {
                            onRemove: () => { props.onRemoveTag(tag.id); },
                            removeLabel: translate('markets.removeTag'),
                        }}
                />
            ))}

            {isNaming
                ? (
                    <input
                        autoFocus
                        type="text"
                        name="tagLabel"
                        aria-label={translate('markets.tagLabel')}
                        placeholder={translate('markets.tagLabel')}
                        className={`${CONTROL_INPUT_CLASSES} h-9 w-36 shrink-0 px-2 lg:w-full`}
                        onBlur={(event) => { props.onAddTag(event.target.value); setIsNaming(false); }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                props.onAddTag(event.currentTarget.value);
                                setIsNaming(false);
                            }
                            if (event.key === 'Escape') {
                                setIsNaming(false);
                            }
                        }}
                    />
                )
                : <RailAdd said={translate('markets.newTag')} onPress={() => { setIsNaming(true); }} />}

            <RailHeading said={translate('markets.venues')} />
            {props.venues.map((venue) => (
                <RailRow
                    key={venue}
                    said={venue}
                    isOn={props.showing.kind === 'venue' && props.showing.venue === venue}
                    onPress={() => { props.onBrowse(venue); }}
                    {...props.broughtVenues.has(venue)
                        ? {
                            onRemove: () => { props.onRemoveVenue(venue); },
                            removeLabel: translate('markets.removeVenue'),
                        }
                        : {}}
                />
            ))}

            {props.onWriteConnector !== undefined && (
                <RailAdd said={translate('markets.addVenue')} onPress={props.onWriteConnector} />
            )}
        </nav>
    );
}

/** A heading in the rail, which lies down with it on a phone. */
function RailHeading({ said }: { readonly said: string }): ReactElement {
    return (
        <h3 className="hidden px-2 pb-1 pt-3 field-label first:pt-1 lg:block">{said}</h3>
    );
}

interface RailRowProps {
    readonly said: string;
    readonly count?: number;
    /** True where the listing is showing this one. */
    readonly isOn: boolean;
    readonly onPress: () => void;
    readonly onRemove?: (() => void) | undefined;
    readonly removeLabel?: string | undefined;
    readonly children?: ReactElement | undefined;
}

/** One target in the rail: a venue to browse, or a tag with its mark on it. */
function RailRow({ said, count, isOn, onPress, onRemove, removeLabel, children }: RailRowProps): ReactElement {
    return (
        <div className={`group flex shrink-0 items-center rounded-lg ${isOn ? CONTROL_CHOSEN_CLASSES : ''}`}>
            {children}
            <button
                type="button"
                aria-current={isOn}
                onClick={onPress}
                className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-xs font-semibold transition-colors ${
                    isOn ? '' : 'text-ink-300 hover:bg-abyss-700 hover:text-ink-100'
                } ${children === undefined ? '' : 'pl-1'}`}
            >
                <span className="truncate">{said}</span>
                {count !== undefined && count > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-current/15 px-1.5 text-[10px]">{count}</span>
                )}
            </button>
            {onRemove !== undefined && (
                <button
                    type="button"
                    aria-label={`${removeLabel ?? ''} ${said}`.trim()}
                    onClick={onRemove}
                    className="mr-1 hidden size-7 shrink-0 place-items-center rounded text-ink-500 transition-colors hover:bg-abyss-700 hover:text-amber group-hover:grid group-focus-within:grid"
                >
                    <Trash2 size={13} />
                </button>
            )}
        </div>
    );
}

interface TagRowProps extends Omit<RailRowProps, 'children'> {
    readonly colour: TagColour;
    readonly translate: Translate;
    readonly onRecolour: (colour: TagColour) => void;
}

/**
 * One tag in the rail, with the colour it marks its pairs in.
 *
 * The swatch is the control as well as the mark: it is where the tag's colour
 * is read and where it is changed, so the reader looking for one is already
 * pointing at the other.
 */
function TagRow({ colour, translate, onRecolour, ...row }: TagRowProps): ReactElement {
    return (
        <RailRow {...row}>
            <TagColourPicker
                colour={colour}
                label={row.said}
                translate={translate}
                onPick={onRecolour}
            />
        </RailRow>
    );
}

/** The dashed way to add one more, in the rail's own row shape. */
function RailAdd({ said, onPress }: { readonly said: string; readonly onPress: () => void }): ReactElement {
    return (
        <button
            type="button"
            onClick={onPress}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-hairline px-2.5 text-xs font-semibold text-ink-400 transition-colors hover:border-hairline-bright hover:text-ink-100"
        >
            <Plus className="size-3.5 shrink-0" />
            <span className="truncate">{said}</span>
        </button>
    );
}
