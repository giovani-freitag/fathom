import type { ReactElement } from 'react';
import { CONTROL_INPUT_CLASSES } from '../control-shell.ts';
import { RailAdd, RailHeading, RailRow, type RailRowProps } from './rail-row.tsx';
import { ConfirmDialog } from '../confirm-dialog.tsx';
import { FAVOURITES_ID, type PairTag, type TagColour } from '../../../shared/core/pair-tags.ts';
import { labelOf } from '../../markets/tag-names.ts';
import { TagColourPicker } from './tag-colour-picker.tsx';
import type { Translate } from '../../i18n/translator.ts';
import { useState } from 'react';
import { useEscapeGuard } from '../escape-guard.ts';

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
    const [isNaming, setIsNaming] = useState(false);
    // Which tag is being taken away, while the reader is being asked about it.
    const [dropping, setDropping] = useState<PairTag | null>(null);

    return (
        <>
            <nav
                aria-label={translate('markets.sources')}
                className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline p-2"
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
                        <TagNameField
                            translate={translate}
                            onName={(label) => { props.onAddTag(label); setIsNaming(false); }}
                            onGiveUp={() => { setIsNaming(false); }}
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

            <ConfirmDialog
                isOpen={dropping !== null}
                onOpenChange={(isOpen) => { if (!isOpen) { setDropping(null); } }}
                title={translate('markets.removeTagTitle')}
                body={translate('markets.removeTagBody', {
                    tag: dropping === null ? '' : labelOf(dropping, translate),
                    // Counted in words rather than glued to a plural that is
                    // wrong for exactly one of them.
                    count: dropping?.pairs.length === 1
                        ? translate('markets.onePair')
                        : translate('markets.somePairs', { count: String(dropping?.pairs.length ?? 0) }),
                })}
                confirmLabel={translate('markets.removeTagConfirm')}
                onConfirm={() => {
                    if (dropping !== null) {
                        props.onRemoveTag(dropping.id);
                    }
                    setDropping(null);
                }}
            />
        </>
    );
}

interface TagNameFieldProps {
    readonly translate: Translate;
    readonly onName: (label: string) => void;
    readonly onGiveUp: () => void;
}

/**
 * Where a new tag is given its name.
 *
 * One field shared by both layouts rather than one inside the rail: the rail is
 * not built on a phone, so the press that asked for a name changed the state
 * and drew nothing at all.
 */
export function TagNameField({ translate, onName, onGiveUp }: TagNameFieldProps): ReactElement {
    useEscapeGuard(true);

    return (
        <input
            autoFocus
            type="text"
            name="tagLabel"
            aria-label={translate('markets.tagLabel')}
            placeholder={translate('markets.tagLabel')}
            autoCapitalize="off"
            autoCorrect="off"
            className={`${CONTROL_INPUT_CLASSES} h-9 w-36 shrink-0 px-2 lg:w-full`}
            onBlur={(event) => { onName(event.target.value); }}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    onName(event.currentTarget.value);
                }
                if (event.key === 'Escape') {
                    onGiveUp();
                }
            }}
        />
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

