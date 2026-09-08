import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListingBanner, ListingCard, RailBar, SearchField } from './listing-card.tsx';
import { FAVOURITES_ID, findTagsHolding, type MarketPair, type PairTag } from '../../../shared/core/pair-tags.ts';
import { ArrowLeft, Pencil, Plug, TagPlus } from 'lucide-react';
import { CONTROL_BUTTON_CLASSES, CONTROL_HEIGHT, CONTROL_RESTING_CLASSES } from '../control-shell.ts';
import { ListingBody, ListingFooting, QuoteFilter, Said } from './listing-body.tsx';
import { MarketsRail, type Showing } from './markets-rail.tsx';
import { Select } from '../select.tsx';
import { TagCard } from './tag-card.tsx';
import { RemoveTagDialog } from './remove-tag-dialog.tsx';
import { labelOf } from '../../markets/tag-names.ts';
import { narrowPairs, summariseQuotes } from '../../markets/pair-listing.ts';
import { PairTable, type PairRow } from './pair-table.tsx';
import { TagSwatch } from './tag-swatch.tsx';
import { VenueMark } from './venue-mark.tsx';
import { type Listing, readInstruments } from '../../core/markets-controller.ts';
import type { Translate } from '../../i18n/translator.ts';
import { readFactsFor } from '../../../shared/venues/venue-registry.ts';
import { useChartSlice } from '../../react/use-chart-state.ts';
import { useMarkets } from '../../react/use-markets.ts';
import { useTranslate } from '../../react/use-appearance.ts';
import { useVenueListing } from '../../react/use-venue-listing.ts';
import { useHasRoomForRail } from '../../react/use-room-for-rail.ts';
import { TYPING_SETTLES_MS, useSettled } from '../../react/use-long-listing.ts';

/** What the card that names a tag is open on. */
type Carding = { readonly kind: 'new' } | { readonly kind: 'tag'; readonly tagId: string };

interface MarketsPanelProps {
    /** Closes the card the panel is in, once a pair has been picked. */
    readonly onClose: () => void;
    /** Puts a pair on the chart. */
    readonly onOpen: (pair: MarketPair) => void;
    /** Which pair the chart is showing, so the table can say which. */
    readonly open: MarketPair | null;
    /** Opens the editor, where a connector is written like any other addon. */
    readonly onWriteConnector?: (() => void) | undefined;
    /** Opens the editor on a venue the reader brought, to change its connector. */
    readonly onEditConnector?: ((venue: string) => void) | undefined;
}

/**
 * The contracts, on a card large enough to read a listing on.
 *
 * The same dropdown every other question on this bar opens, given the room the
 * answer needs: a venue publishes over a thousand pairs, and a column three
 * hundred pixels wide showing eight at a time is a scroll bar with a chart
 * behind it.
 *
 * Inside, the shape is the one every venue's own interface settled on — targets
 * down one side, a search and a row of quote chips along the top, and the
 * listing itself filling the rest.
 */
export function MarketsPanel({
    onClose,
    onOpen,
    open,
    onWriteConnector,
    onEditConnector,
}: MarketsPanelProps): ReactElement {
    const translate = useTranslate();
    // Measured off this card rather than off the window: the same card is
    // mounted in a dropdown and in a sheet, and the room it has is its own.
    const card = useRef<HTMLDivElement>(null);
    const isWide = useHasRoomForRail(card);
    const { state, markets } = useMarkets();
    // On what the reader keeps rather than on a catalogue. Only a recorded
    // pair can be drawn, and those are the ones under a tag: a venue's listing
    // opens on nine hundred rows of which four can be pressed, and asks the
    // venue for them before the card has finished appearing.
    const [showing, setShowing] = useState<Showing>({ kind: 'tag' });
    const [query, setQuery] = useState('');
    const narrowedBy = useSettled(query);
    // Which tag the card is open on, or that it is open on one being made.
    const [carding, setCarding] = useState<Carding | null>(null);
    // Which tag is being taken away, while the reader is being asked about it.
    const [dropping, setDropping] = useState<PairTag | null>(null);
    const [quote, setQuote] = useState('');

    // Selected as the array the store already holds and turned into a set here.
    // A selector that builds the set is a new set on every read, and the store
    // compares what it read by identity.
    const instruments = useChartSlice((chart) => chart.instruments);
    const recorded = useMemo(
        () => new Set(instruments.map((one) => `${one.venue}/${one.instrumentSymbol}`)),
        [instruments],
    );

    // Only what the reader installed. The venue this build ships against is not
    // theirs to take away, and offering to would be offering to break the chart.
    const brought = useMemo(
        () => new Set(state.installed.map((one) => one.id)),
        [state.installed],
    );
    const openTag = state.tags.find((tag) => tag.id === state.openTagId) ?? state.tags[0];
    // The tag the card is on, which is nothing at all while one is being made.
    const carded = carding?.kind === 'tag'
        ? state.tags.find((tag) => tag.id === carding.tagId)
        : undefined;
    const tagLabel = openTag === undefined ? '' : labelOf(openTag, translate);
    const tagColour = openTag?.colour ?? 'phosphor';
    const listing = useVenueListing(showing.kind === 'venue' ? showing.venue : null);

    // Asked of the venue itself, where it answers such questions. The listing
    // may still be arriving, and searching the part that happens to have landed
    // is how a reader concludes a pair is not there.
    useEffect(() => {
        if (showing.kind !== 'venue') {
            return undefined;
        }

        const venue = showing.venue;
        const asking = setTimeout(() => { void markets.searchListing(venue, query); }, TYPING_SETTLES_MS);
        return () => { clearTimeout(asking); };
    }, [markets, query, showing]);

    // What a row can be opened on is what the venue publishes, not what this
    // recording happens to hold: the candles and the traded volume come from
    // the venue and were never recorded, so a contract nobody recorded still
    // draws. Only a venue that declares nothing at all has nothing to show.
    const canDraw = useCallback((pair: MarketPair): boolean => (
        readFactsFor(pair.venue).size > 0
    ), []);

    const sayWhyNot = useCallback((): string => (
        translate('markets.nothingToDraw')
    ), [translate]);

    // Pointing the listing somewhere else clears what was typed at the last
    // one. A search reads as a search of everything, and carried across it
    // quietly answers a question about one venue with another venue's rows —
    // or with none, and no sign of why.
    const show = useCallback((wanted: Showing) => {
        setShowing(wanted);
        setQuery('');
        setQuote('');
    }, []);

    const listed = useMemo(() => readInstruments(listing), [listing]);

    // The venue's own answer, where it gave one for what is typed now. Matched
    // on the term as well as the venue: an answer to the previous word is worse
    // than no answer at all.
    const answered = useMemo(() => {
        const search = state.search;
        return showing.kind === 'venue' && search !== null && search.venue === showing.venue
            && search.term === query.trim() && search.kind === 'read'
            ? search.instruments
            : null;
    }, [state.search, showing, query]);

    // What this venue is recording, which the row cut is not allowed to drop.
    const recordedHere = useMemo(() => new Set(
        showing.kind === 'venue'
            ? instruments.filter((one) => one.venue === showing.venue).map((one) => one.instrumentSymbol)
            : [],
    ), [instruments, showing]);

    const openOne = useCallback((pair: MarketPair) => {
        onOpen(pair);
        onClose();
    }, [onOpen, onClose]);

    const keepOne = useCallback((pair: MarketPair, tagId: string, isOn: boolean) => {
        if (isOn) {
            markets.tagPair(tagId, pair);
        } else {
            markets.untagPair(tagId, pair);
        }
    }, [markets]);

    const quotes = useMemo(() => (listed === null ? [] : summariseQuotes(listed)), [listed]);
    const narrowed = useMemo(() => {
        if (answered !== null) {
            // Narrowed by the chip alone: the venue has already decided what
            // the typing matched, and matching it again with our own rule drops
            // the rows it read more generously than we would have.
            return narrowPairs(answered, { query: '', quote });
        }
        return listed === null ? null : narrowPairs(listed, { query: narrowedBy, quote, keep: recordedHere });
    }, [answered, listed, narrowedBy, quote, recordedHere]);

    // What a row is filed under, which its own first cell both shows and
    // changes. Read per row rather than per tag: a pair carries several, and
    // the row is where a reader is looking when they decide.
    const heldBy = useCallback((pair: MarketPair): ReadonlySet<string> => (
        new Set(findTagsHolding(state.tags, pair).map((tag) => tag.id))
    ), [state.tags]);

    const rows: readonly PairRow[] = useMemo(() => {
        if (showing.kind === 'tag') {
            return (openTag?.pairs ?? []).map((pair) => {
                const isOpenable = canDraw(pair);
                return {
                    pair,
                    base: '',
                    quote: '',
                    held: heldBy(pair),
                    isOpenable,
                    whyNot: sayWhyNot(),
                    // Under a tag, the rare fact is which of the kept pairs
                    // this recording also holds a book for.
                    note: recorded.has(`${pair.venue}/${pair.symbol}`)
                        ? translate('markets.recorded')
                        : '',
                };
            }).filter((row) => matchesQuery(row.pair.symbol, narrowedBy));
        }

        return (narrowed?.shown ?? []).map((instrument) => {
            const pair = { venue: showing.venue, symbol: instrument.symbol };
            const isOpenable = canDraw(pair);
            return {
                pair,
                base: instrument.base,
                quote: instrument.quote,
                held: heldBy(pair),
                isOpenable,
                whyNot: sayWhyNot(),
                // On a venue's own listing the reason is true of almost every
                // row, and a column that repeats nine hundred times says
                // nothing. What is rare here is the handful this chart holds.
                note: markNote(
                    instrument.isTrading,
                    recorded.has(`${pair.venue}/${pair.symbol}`),
                    translate,
                ),
            };
        });
    }, [showing, openTag, recorded, canDraw, sayWhyNot, heldBy, narrowed, narrowedBy, translate]);

    return (
        <ListingCard
            boxRef={card}
            isRailBeside={isWide}
            search={(
                <SearchField
                    hasFocus
                    label={translate('markets.searchPairs')}
                    value={query}
                    onChange={setQuery}
                />
            )}
            rail={carding !== null && !isWide
                // The card is a step of its own; the filters behind it belong to
                // the listing it stepped away from.
                ? undefined
                : !isWide
                    ? (
                        <RailBar>
                            {/* One control for what is being looked at, and two
                                for making one more of each kind. The kinds are
                                unlike enough that one button for both would
                                have to ask which — and that is a question the
                                icons answer without being asked. */}
                            <Select
                                label={translate('markets.sources')}
                                value={showing.kind === 'tag'
                                    ? `tag:${openTag?.id ?? FAVOURITES_ID}`
                                    : `venue:${showing.venue}`}
                                choices={[
                                    ...state.tags.map((one) => ({
                                        value: `tag:${one.id}`,
                                        label: labelOf(one, translate),
                                        detail: String(one.pairs.length),
                                        group: translate('markets.yourTags'),
                                        // The colour is how a reader picks a tag
                                        // out of a column of rows; it should be
                                        // how they pick it here too.
                                        icon: <TagSwatch colour={one.colour} className="size-2.5" />,
                                    })),
                                    ...state.venues.map((one) => ({
                                        value: `venue:${one}`,
                                        label: one,
                                        group: translate('markets.venues'),
                                        icon: <VenueMark venue={one} />,
                                    })),
                                ]}
                                onSelect={(picked) => {
                                    const [kind, ...rest] = picked.split(':');
                                    const named = rest.join(':');
                                    if (kind === 'tag') {
                                        markets.openTag(named);
                                        show({ kind: 'tag' });
                                        return;
                                    }
                                    show({ kind: 'venue', venue: named });
                                }}
                            />

                            {/* What is being looked at is what this changes,
                                because the control above already says which one
                                that is. Absent rather than dead where there is
                                nothing to change: a venue this build ships is
                                not the reader's to edit. */}
                            {(showing.kind === 'tag' || (onEditConnector !== undefined && brought.has(showing.venue))) && (
                                <button
                                    type="button"
                                    aria-label={translate(showing.kind === 'tag' ? 'markets.editTag' : 'markets.editConnector')}
                                    title={translate(showing.kind === 'tag' ? 'markets.editTag' : 'markets.editConnector')}
                                    onClick={() => {
                                        if (showing.kind === 'venue') {
                                            onEditConnector?.(showing.venue);
                                            return;
                                        }
                                        setCarding({ kind: 'tag', tagId: openTag?.id ?? FAVOURITES_ID });
                                    }}
                                    className={`${CONTROL_BUTTON_CLASSES} shrink-0 border border-hairline bg-abyss-800/80 ${CONTROL_RESTING_CLASSES}`}
                                >
                                    <Pencil className="size-4" />
                                </button>
                            )}

                            <button
                                type="button"
                                aria-label={translate('markets.newTag')}
                                title={translate('markets.newTag')}
                                onClick={() => { setCarding({ kind: 'new' }); }}
                                className={`${CONTROL_BUTTON_CLASSES} shrink-0 border border-hairline bg-abyss-800/80 ${CONTROL_RESTING_CLASSES}`}
                            >
                                <TagPlus className="size-4" />
                            </button>

                            {onWriteConnector !== undefined && (
                                <button
                                    type="button"
                                    aria-label={translate('markets.addVenue')}
                                    title={translate('markets.addVenue')}
                                    onClick={onWriteConnector}
                                    className={`${CONTROL_BUTTON_CLASSES} shrink-0 border border-hairline bg-abyss-800/80 ${CONTROL_RESTING_CLASSES}`}
                                >
                                    {/* A plug rather than a building: what is
                                        being added is a connector, and that is
                                        the word the reader will meet everywhere
                                        else this thing is named. A building says
                                        the venue is what gets made here, and a
                                        reader who presses it expecting a form
                                        finds an editor. */}
                                    <Plug className="size-4" />
                                </button>
                            )}
                        </RailBar>
                    )
                    : (
                        <MarketsRail
                            tags={state.tags}
                            venues={state.venues}
                            openTagId={openTag?.id ?? FAVOURITES_ID}
                            showing={showing}
                            translate={translate}
                            onOpenTag={(tagId) => { markets.openTag(tagId); show({ kind: 'tag' }); }}
                            onBrowse={(venue) => { show({ kind: 'venue', venue }); }}
                            onAddTag={() => { setCarding({ kind: 'new' }); }}
                            onEditTag={(tagId) => { setCarding({ kind: 'tag', tagId }); }}
                            onRemoveTag={(tagId) => { markets.removeTag(tagId); }}
                            onRemoveVenue={(venue) => { markets.removeConnector(venue); show({ kind: 'tag' }); }}
                            broughtVenues={brought}
                            onWriteConnector={onWriteConnector}
                            onEditConnector={onEditConnector}
                        />
                    )}
            // Narrow, the select above already says what is being looked at, and
            // the banner saying it again is the same answer twice on the screen
            // with least room for it. And the card is a step of its own: left up,
            // the strip went on naming the listing behind it, so a reader editing
            // one tag from the rail was shown another tag's name directly over
            // the field they were typing into.
            banner={!isWide || carding !== null
                ? undefined
                : (
                // What is being looked at, which is the tag the rail is on or
                // the venue being browsed. Filing is done on the row itself, so
                // this says nothing about where a press would put anything.
                    <ListingBanner
                        said={showing.kind === 'tag' ? tagLabel : showing.venue}
                        {...showing.kind === 'tag'
                            ? { mark: <TagSwatch colour={tagColour} className="size-2" /> }
                            : {}}
                    >
                        <QuoteFilter
                            quotes={quotes}
                            quote={quote}
                            translate={translate}
                            onPick={setQuote}
                        />
                    </ListingBanner>
                )}
            footing={carding !== null
                // The card is a step of its own, at every width: a line counting
                // the catalogue behind it overlapped the card's own buttons in
                // landscape, and on a desktop it sat under the tag's name
                // counting a listing the card was standing in front of.
                ? undefined
                : (
                    <ListingFooting
                        listing={listing}
                        shown={narrowed?.shown.length ?? 0}
                        matched={narrowed?.matched ?? 0}
                        isAsking={state.search?.kind === 'reading'}
                        translate={translate}
                    />
                )}
        >
            {carding !== null
                ? (
                    <>
                        <button
                            type="button"
                            onClick={() => { setCarding(null); }}
                            className={`flex ${CONTROL_HEIGHT} shrink-0 items-center gap-1.5 px-3 text-xs text-ink-500 hover:text-ink-100`}
                        >
                            <ArrowLeft className="size-3.5" />
                            {translate('markets.title')}
                        </button>
                        <TagCard
                            translate={translate}
                            {...carded === undefined ? {} : { tag: carded }}
                            {...carded === undefined || carded.id === FAVOURITES_ID
                                // The first tag is the one a reader lands on, and
                                // the model refuses to take it away. Offering the
                                // button anyway is a press that does nothing.
                                ? {}
                                : { onRemove: () => { setDropping(carded); } }}
                            onSave={(label, colour) => {
                                if (carded !== undefined) {
                                    // A blank name is refused by the model, which
                                    // is what a reader who came for the colour
                                    // wants: the tag keeps what it was called.
                                    markets.relabelTag(carded.id, label);
                                    markets.recolourTag(carded.id, colour);
                                    setCarding(null);
                                    return;
                                }

                                const tagId = markets.addTag(label);
                                if (tagId !== null) {
                                    markets.recolourTag(tagId, colour);
                                    // Shown as well as made: a reader who has
                                    // just named a tag is about to file
                                    // something under it, and landing back on
                                    // the catalogue they left means the next
                                    // press goes somewhere they did not ask for.
                                    markets.openTag(tagId);
                                    show({ kind: 'tag' });
                                }
                                setCarding(null);
                            }}
                            onGiveUp={() => { setCarding(null); }}
                        />
                    </>
                )
                : (
                    <Body
                        showing={showing}
                        listing={listing}
                        rowCount={rows.length}
                        query={query}
                        translate={translate}
                        onRetry={() => {
                            if (showing.kind === 'venue') {
                                void markets.readListing(showing.venue);
                            }
                        }}
                    >
                        <PairTable
                            rows={rows}
                            hasVenueColumn={showing.kind === 'tag'}
                            open={open}
                            tags={state.tags}
                            translate={translate}
                            onOpen={openOne}
                            onKeep={keepOne}
                        />
                    </Body>
                )}

            <RemoveTagDialog
                tag={dropping}
                translate={translate}
                onGiveUp={() => { setDropping(null); }}
                onConfirm={(tagId) => {
                    markets.removeTag(tagId);
                    // The card was on the tag that just went, so there is
                    // nothing left for it to be about.
                    setCarding(null);
                    show({ kind: 'tag' });
                }}
            />
        </ListingCard>
    );
}

interface BodyProps {
    readonly showing: Showing;
    readonly listing: Listing;
    readonly rowCount: number;
    readonly query: string;
    readonly translate: Translate;
    readonly onRetry: () => void;
    readonly children: ReactElement;
}

/**
 * The table, or the one sentence that stands in for it.
 *
 * A tag is not a listing: it holds what the reader put in it, so it is never
 * unread, never refused, and empty for a reason of its own. That is the whole
 * of what this adds to the shared body.
 */
function Body({ showing, listing, rowCount, query, translate, onRetry, children }: BodyProps): ReactElement {
    if (showing.kind === 'tag') {
        return rowCount === 0 ? <Said said={translate('markets.emptyTag')} /> : children;
    }

    return (
        <ListingBody
            listing={listing}
            rowCount={rowCount}
            query={query}
            emptySaid={translate('markets.noPairs')}
            translate={translate}
            onRetry={onRetry}
        >
            {children}
        </ListingBody>
    );
}

/**
 * The word at the end of a venue's row: what is rare about it, or nothing.
 */
function markNote(isTrading: boolean, isRecorded: boolean, translate: Translate): string {
    if (!isTrading) {
        return translate('markets.halted');
    }
    return isRecorded ? translate('markets.recorded') : '';
}

/**
 * Whether a kept pair answers what was typed.
 *
 * Only the symbol, because a tag holds pairs rather than a venue's listing and
 * has no assets of its own to match against.
 */
function matchesQuery(symbol: string, query: string): boolean {
    const wanted = query.trim().toUpperCase();
    return wanted === '' || symbol.toUpperCase().includes(wanted);
}
