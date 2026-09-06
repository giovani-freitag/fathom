import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { ListingBanner, ListingCard, RailBar, SearchField } from './listing-card.tsx';
import { FAVOURITES_ID, findTagsHolding, type MarketPair } from '../../../shared/core/pair-tags.ts';
import { ArrowLeft, Plug, TagPlus } from 'lucide-react';
import { CONTROL_BUTTON_CLASSES, CONTROL_RESTING_CLASSES } from '../control-shell.ts';
import { ListingBody, ListingFooting, QuoteFilter, Said } from './listing-body.tsx';
import { MarketsRail, type Showing } from './markets-rail.tsx';
import { Select } from '../select.tsx';
import { NewTagCard } from './new-tag-card.tsx';
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
import { useIsViewportAtLeast } from '../../react/use-viewport-width.ts';
import { TYPING_SETTLES_MS, useSettled } from '../../react/use-long-listing.ts';

/** What is known about a venue nobody has asked about yet. */
const UNREAD: Listing = { kind: 'unread' };

interface MarketsPanelProps {
    /** Closes the card the panel is in, once a pair has been picked. */
    readonly onClose: () => void;
    /** Puts a pair on the chart. */
    readonly onOpen: (pair: MarketPair) => void;
    /** Which pair the chart is showing, so the table can say which. */
    readonly open: MarketPair | null;
    /** Opens the editor, where a connector is written like any other addon. */
    readonly onWriteConnector?: (() => void) | undefined;
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
}: MarketsPanelProps): ReactElement {
    const translate = useTranslate();
    // On a phone the select above says what is being looked at, so the banner
    // saying it again is the same answer twice on the screen with least room
    // for it.
    const isWide = useIsViewportAtLeast('lg');
    const { state, markets } = useMarkets();
    // On what the reader keeps rather than on a catalogue. Only a recorded
    // pair can be drawn, and those are the ones under a tag: a venue's listing
    // opens on nine hundred rows of which four can be pressed, and asks the
    // venue for them before the card has finished appearing.
    const [showing, setShowing] = useState<Showing>({ kind: 'tag' });
    const [query, setQuery] = useState('');
    const narrowedBy = useSettled(query);
    // Which body the sheet is showing on a phone: the pairs, or one kind of
    // source. Two shapes of the same question are behind `?picker=`, so they
    // can be put in front of readers rather than argued about.
    const [isNamingTag, setIsNamingTag] = useState(false);
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
    const tagLabel = openTag === undefined ? '' : labelOf(openTag, translate);
    const tagColour = openTag?.colour ?? 'phosphor';
    const listing: Listing = useMemo(
        () => (showing.kind === 'venue' ? state.listings[showing.venue] ?? UNREAD : UNREAD),
        [showing, state.listings],
    );

    // Asked for the moment a venue is shown rather than on a press of its own:
    // a reader who picked a venue is already asking what there is to pick.
    useEffect(() => {
        if (showing.kind === 'venue' && listing.kind === 'unread') {
            void markets.readListing(showing.venue);
        }
    }, [listing.kind, markets, showing]);

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

    // Two different answers, because a reader who reads the first one for the
    // second goes looking for a broken recording instead of for the `null` their
    // own connector declared.
    const sayWhyNot = useCallback((pair: MarketPair): string => (
        readFactsFor(pair.venue).size === 0
            ? translate('markets.nothingToDraw')
            : translate('markets.notRecorded')
    ), [translate]);

    // The same answer in two words, for the column at the end of a row. The
    // whole sentence is on the row's own label and its tooltip, where there is
    // room for it.
    const noteWhyNot = useCallback((pair: MarketPair): string => (
        readFactsFor(pair.venue).size === 0
            ? translate('markets.noteNothingToDraw')
            : translate('markets.noteNotRecorded')
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
                const isOpenable = recorded.has(`${pair.venue}/${pair.symbol}`);
                return {
                    pair,
                    base: '',
                    quote: '',
                    held: heldBy(pair),
                    isOpenable,
                    whyNot: sayWhyNot(pair),
                    // Under a tag, what a reader wants to know is why the one
                    // they kept will not open.
                    note: isOpenable ? '' : noteWhyNot(pair),
                };
            }).filter((row) => matchesQuery(row.pair.symbol, narrowedBy));
        }

        return (narrowed?.shown ?? []).map((instrument) => {
            const pair = { venue: showing.venue, symbol: instrument.symbol };
            const isOpenable = recorded.has(`${pair.venue}/${pair.symbol}`);
            return {
                pair,
                base: instrument.base,
                quote: instrument.quote,
                held: heldBy(pair),
                isOpenable,
                whyNot: sayWhyNot(pair),
                // On a venue's own listing the reason is true of almost every
                // row, and a column that repeats nine hundred times says
                // nothing. What is rare here is the handful this chart holds.
                note: markNote(instrument.isTrading, isOpenable, translate),
            };
        });
    }, [showing, openTag, recorded, sayWhyNot, noteWhyNot, heldBy, narrowed, narrowedBy, translate]);

    return (
        <ListingCard
            search={(
                <SearchField
                    hasFocus
                    label={translate('markets.searchPairs')}
                    value={query}
                    onChange={setQuery}
                />
            )}
            rail={isNamingTag && !isWide
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

                            <button
                                type="button"
                                aria-label={translate('markets.newTag')}
                                title={translate('markets.newTag')}
                                onClick={() => { setIsNamingTag(true); }}
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
                            onAddTag={(label) => { markets.addTag(label); show({ kind: 'tag' }); }}
                            onRemoveTag={(tagId) => { markets.removeTag(tagId); }}
                            onRecolourTag={(tagId, tone) => { markets.recolourTag(tagId, tone); }}
                            onRemoveVenue={(venue) => { markets.removeConnector(venue); show({ kind: 'tag' }); }}
                            broughtVenues={brought}
                            onWriteConnector={onWriteConnector}
                        />
                    )}
            banner={!isWide ? undefined : (
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
            footing={isNamingTag && !isWide
                // The card is a step of its own: a line counting the catalogue
                // behind it overlapped the card's own buttons in landscape, and
                // counted rows nobody could see in either.
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
            {isNamingTag && !isWide
                ? (
                    <>
                        <button
                            type="button"
                            onClick={() => { setIsNamingTag(false); }}
                            className="flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-xs text-ink-500 hover:text-ink-100"
                        >
                            <ArrowLeft className="size-3.5" />
                            {translate('markets.title')}
                        </button>
                        <NewTagCard
                            translate={translate}
                            onMake={(label, colour) => {
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
                                setIsNamingTag(false);
                            }}
                            onGiveUp={() => { setIsNamingTag(false); }}
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
function markNote(isTrading: boolean, isOpenable: boolean, translate: Translate): string {
    if (!isTrading) {
        return translate('markets.halted');
    }
    return isOpenable ? translate('markets.recorded') : '';
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
