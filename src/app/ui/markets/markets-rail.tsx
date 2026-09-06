import type { ReactElement } from 'react';
import { RailColumn } from './listing-card.tsx';
import { RemoveTagDialog } from './remove-tag-dialog.tsx';
import { RailAdd, RailHeading, RailRow, type RailRowProps } from './rail-row.tsx';
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
    /** Opens the card a tag is named and coloured on, on a new one. */
    readonly onAddTag: () => void;
    /** Opens that same card on a tag that exists. */
    readonly onEditTag: (tagId: string) => void;
    readonly onRemoveTag: (tagId: string) => void;
    readonly onRecolourTag: (tagId: string, colour: TagColour) => void;
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

                {/* The same card a phone names one on, rather than a field
                    that asks half the question: a tag made here used to arrive
                    in whatever colour was next in the list, which is the colour
                    a reader spends the next minutes learning to recognise. */}
                <RailAdd said={translate('markets.newTag')} onPress={props.onAddTag} />

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
                        {...props.broughtVenues.has(venue) && props.onEditConnector !== undefined
                            // A venue this build ships is not the reader's to
                            // change: its connector is in the build, not in
                            // their library, and the editor has nothing to open.
                            ? {
                                onEdit: () => { props.onEditConnector?.(venue); },
                                editLabel: translate('markets.editConnector'),
                            }
                            : {}}
                    />
                ))}

                {props.onWriteConnector !== undefined && (
                    <RailAdd said={translate('markets.addVenue')} onPress={props.onWriteConnector} />
                )}

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

