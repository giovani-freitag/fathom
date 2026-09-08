import type { ReactElement } from 'react';
import { RailColumn } from './listing-card.tsx';
import { RemoveTagDialog } from './remove-tag-dialog.tsx';
import { RailHeading, RailRow, type RailRowProps } from './rail-row.tsx';
import { FAVOURITES_ID, type PairTag, type TagColour } from '../../../shared/core/pair-tags.ts';
import { labelOf } from '../../markets/tag-names.ts';
import { TagSwatch } from './tag-swatch.tsx';
import { VenueMark } from './venue-mark.tsx';
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
    /** Opens the card a tag is named and coloured on, on a new one. */
    readonly onAddTag: () => void;
    /** Opens that same card on a tag that exists. */
    readonly onEditTag: (tagId: string) => void;
    readonly onRemoveTag: (tagId: string) => void;
    /** Takes a venue the reader brought back off. The shipped one has no such offer. */
    readonly onRemoveVenue: (venue: string) => void;
    /** Which venues the reader brought, and so may take away again. */
    readonly broughtVenues: ReadonlySet<string>;
    /** Absent where this build carries no editor to write a connector in. */
    readonly onWriteConnector?: (() => void) | undefined;
    /** Opens the editor on a venue the reader brought, to change its connector. */
    readonly onEditConnector?: ((venue: string) => void) | undefined;
}

/**
 * Everything a reader can point the listing at, down one side.
 *
 * Their tags and the venues in one rail rather than in two stacked panels: the
 * question is "which of these am I looking at", and answering it in two places
 * meant a reader who wanted a pair from a second venue had to find out that
 * browsing and keeping were different halves of the same card.
 *
 * On a phone it is not a rail at all. Laid down and scrolled sideways, it put a
 * reader's tags and the venues in one strip with the headings that told them
 * apart hidden, and six of its eight targets past the edge — so the card opened
 * on an empty tag, and the venues that would have filled it were off screen
 * behind a scroll nothing announced. A phone gets the question asked outright,
 * in the one select this interface has, with the two kinds under their own
 * headings.
 */
export function MarketsRail(props: MarketsRailProps): ReactElement {
    const { translate } = props;
    // Which tag is being taken away, while the reader is being asked about it.
    const [dropping, setDropping] = useState<PairTag | null>(null);

    return (
        <>
            <RailColumn said={translate('markets.sources')}>
                <RailHeading
                    said={translate('markets.yourTags')}
                    onAdd={props.onAddTag}
                    addLabel={translate('markets.newTag')}
                />
                {props.tags.map((tag) => (
                    <TagRow
                        key={tag.id}
                        said={labelOf(tag, translate)}
                        colour={tag.colour}
                        count={tag.pairs.length}
                        isOn={props.showing.kind === 'tag' && props.openTagId === tag.id}
                        onPress={() => { props.onOpenTag(tag.id); }}
                        onEdit={() => { props.onEditTag(tag.id); }}
                        editLabel={translate('markets.editTag')}
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

                {/* The offer to add a venue sits on the heading only where
                    this build carries an editor to write a connector in. */}
                <RailHeading
                    said={translate('markets.venues')}
                    {...props.onWriteConnector === undefined
                        ? {}
                        : {
                            onAdd: props.onWriteConnector,
                            addLabel: translate('markets.addVenue'),
                        }}
                />
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
                        {...props.broughtVenues.has(venue) && props.onEditConnector !== undefined
                            // A venue this build ships is not the reader's to
                            // change: its connector is in the build, not in
                            // their library, and the editor has nothing to open.
                            ? {
                                onEdit: () => { props.onEditConnector?.(venue); },
                                editLabel: translate('markets.editConnector'),
                            }
                            : {}}
                    >
                        {/* The same mark the phone's own picker draws. A tag in
                            this rail carries its colour and a venue carried
                            nothing, so one column read as two kinds of thing on
                            a desktop and as one kind on a phone. */}
                        <VenueMark venue={venue} className="ml-2 size-4" />
                    </RailRow>
                ))}

            </RailColumn>

            <RemoveTagDialog
                tag={dropping}
                translate={translate}
                onGiveUp={() => { setDropping(null); }}
                onConfirm={props.onRemoveTag}
            />
        </>
    );
}

interface TagRowProps extends Omit<RailRowProps, 'children'> {
    readonly colour: TagColour;
}

/**
 * One tag in the rail, with the colour it marks its pairs in.
 *
 * The swatch is a mark and nothing else. It used to open a colour picker of its
 * own, which is the one thing a reader pressing a row in this rail does not
 * mean: they mean show me this tag. The colour is changed on the card the
 * pencil opens, beside the name, where both halves of one decision are.
 */
function TagRow({ colour, ...row }: TagRowProps): ReactElement {
    return (
        <RailRow {...row}>
            <TagSwatch colour={colour} className="size-2.5 shrink-0" />
        </RailRow>
    );
}

