import type { ReactElement } from 'react';
import { CONTROL_INPUT_CLASSES, SCROLLER_CLASSES } from '../control-shell.ts';
import { RailAdd, RailHeading, RailRow, type RailRowProps } from './rail-row.tsx';
import { ConfirmDialog } from '../confirm-dialog.tsx';
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
    // Which tag is being taken away, while the reader is being asked about it.
    const [dropping, setDropping] = useState<PairTag | null>(null);

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
                            // Asked about only where there is something to
                            // lose: an empty tag is one press to make again.
                            onRemove: () => {
                                if (tag.pairs.length === 0) {
                                    props.onRemoveTag(tag.id);
                                    return;
                                }
                                setDropping(tag);
                            },
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

            <ConfirmDialog
                isOpen={dropping !== null}
                onOpenChange={(isOpen) => { if (!isOpen) { setDropping(null); } }}
                title={translate('markets.removeTagTitle')}
                body={translate('markets.removeTagBody', {
                    tag: dropping === null ? '' : labelOf(dropping, translate),
                    count: String(dropping?.pairs.length ?? 0),
                })}
                confirmLabel={translate('markets.removeTagConfirm')}
                onConfirm={() => {
                    if (dropping !== null) {
                        props.onRemoveTag(dropping.id);
                    }
                    setDropping(null);
                }}
            />
        </nav>
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

